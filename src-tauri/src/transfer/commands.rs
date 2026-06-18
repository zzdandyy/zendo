use crate::sftp::SftpManager;
use crate::sftp::transfer_manager::TransferManager;
use crate::types::SshError;
use super::{CrossTransferEvent, CrossTransferStatus, SourceLabel};
use dashmap::DashMap;
use russh_sftp::protocol::OpenFlags;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

static CROSS_TRANSFERS: std::sync::LazyLock<Arc<DashMap<String, CancellationToken>>> =
    std::sync::LazyLock::new(|| Arc::new(DashMap::new()));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ─── Main command ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cross_transfer(
    app_handle: AppHandle,
    sftp_manager: State<'_, Arc<SftpManager>>,
    _transfer_manager: State<'_, Arc<TransferManager>>,
    src_type: String,
    src_session_id: String,
    src_paths: Vec<String>,
    dst_type: String,
    dst_session_id: String,
    dst_dir: String,
    src_label_str: Option<String>,
    dst_label_str: Option<String>,
) -> Result<String, SshError> {
    let transfer_id = uuid::Uuid::new_v4().to_string();
    let cancel_token = CancellationToken::new();
    CROSS_TRANSFERS.insert(transfer_id.clone(), cancel_token.clone());

    let src_label = parse_label(&src_type, src_label_str);
    let dst_label = parse_label(&dst_type, dst_label_str);
    let app = app_handle.clone();
    let tid = transfer_id.clone();

    let sftp_mgr = sftp_manager.inner().clone();

    tokio::spawn(async move {
        let result = run(
            &app, &sftp_mgr, &tid,
            &src_type, &src_session_id, &src_paths,
            &dst_type, &dst_session_id, &dst_dir,
            &src_label, &dst_label, &cancel_token,
        ).await;

        let status = match result {
            Ok(()) => CrossTransferStatus::Completed,
            Err(_) if cancel_token.is_cancelled() => CrossTransferStatus::Cancelled,
            Err(_) => CrossTransferStatus::Failed,
        };
        let err_msg = result.as_ref().err().map(|e| e.to_string());

        let _ = app.emit("cross:transfer", CrossTransferEvent {
            transfer_id: tid.clone(),
            name: String::new(),
            src_label: src_label.display(),
            dst_label: dst_label.display(),
            status,
            error: err_msg,
            bytes_transferred: 0, total_bytes: 0,
            files_done: 0, files_total: 0,
            speed_bps: 0, eta_secs: None,
            created_at: now_ms(),
        });

        CROSS_TRANSFERS.remove(&tid);
    });

    Ok(transfer_id)
}

fn parse_label(typ: &str, label: Option<String>) -> SourceLabel {
    match typ {
        "local" => SourceLabel::Local,
        "s3" => SourceLabel::S3(label.unwrap_or_else(|| "S3".into())),
        _ => SourceLabel::Host(label.unwrap_or_else(|| "Remote".into())),
    }
}

// ─── Core transfer logic ─────────────────────────────────────────────────────

async fn run(
    app: &AppHandle,
    sftp_manager: &SftpManager,
    transfer_id: &str,
    src_type: &str,
    src_session_id: &str,
    src_paths: &[String],
    dst_type: &str,
    dst_session_id: &str,
    dst_dir: &str,
    src_label: &SourceLabel,
    dst_label: &SourceLabel,
    cancel: &CancellationToken,
) -> Result<(), SshError> {
    // Walk source tree
    let mut file_pairs: Vec<(String, String)> = Vec::new();
    let mut stack = src_paths.to_vec();

    while let Some(src_path) = stack.pop() {
        if cancel.is_cancelled() { return Err(SshError::Cancelled); }
        let (is_dir, children) = stat_entry(src_type, src_session_id, &src_path, sftp_manager).await?;

        if is_dir {
            for child in children {
                stack.push(format!("{src_path}/{child}"));
            }
        } else {
            let name = src_path.rsplit('/').next().unwrap_or(&src_path);
            let dst = if dst_dir.ends_with('/') { format!("{dst_dir}{name}") } else { format!("{dst_dir}/{name}") };
            file_pairs.push((src_path, dst));
        }
    }

    let files_total = file_pairs.len() as u32;
    let mut files_done: u32 = 0;
    let mut bytes_done: u64 = 0;
    let start = std::time::Instant::now();

    emit(app, transfer_id, src_label, dst_label, CrossTransferStatus::InProgress, 0, 0, 0, files_total);

    for (src_path, dst_path) in &file_pairs {
        if cancel.is_cancelled() { return Err(SshError::Cancelled); }

        let chunk = transfer_file(
            src_type, src_session_id, src_path,
            dst_type, dst_session_id, dst_path,
            sftp_manager,
        ).await?;

        bytes_done += chunk;
        files_done += 1;

        let elapsed = start.elapsed().as_secs_f64().max(0.001);
        let speed = (bytes_done as f64 / elapsed) as u64;
        let _eta = if speed > 0 { Some(0u64) } else { None };

        emit(app, transfer_id, src_label, dst_label, CrossTransferStatus::InProgress, bytes_done, 0, files_done, files_total);
    }

    Ok(())
}

/// Returns (is_dir, child_names).
async fn stat_entry(
    typ: &str,
    session_id: &str,
    path: &str,
    sftp_manager: &SftpManager,
) -> Result<(bool, Vec<String>), SshError> {
    match typ {
        "local" => {
            let meta = std::fs::symlink_metadata(path).map_err(|e| SshError::IoError(format!("{path}: {e}")))?;
            if meta.is_dir() {
                let mut children = Vec::new();
                if let Ok(rd) = std::fs::read_dir(path) {
                    for e in rd.flatten() {
                        children.push(e.file_name().to_string_lossy().to_string());
                    }
                }
                Ok((true, children))
            } else {
                Ok((false, vec![]))
            }
        }
        "sftp" | "scp" => {
            let session = sftp_manager.get_session(session_id)
                .map_err(|e| SshError::ChannelError(format!("sftp session: {e}")))?;
            let sftp = session.sftp.lock().await;
            let meta = sftp.metadata(path).await.map_err(|e| {
                SshError::ChannelError(format!("sftp stat {path}: {e}"))
            })?;
            if meta.is_dir() {
                let list = sftp.read_dir(path).await.map_err(|e| {
                    SshError::ChannelError(format!("sftp read_dir {path}: {e}"))
                })?;
                let children = list.map(|f| f.file_name().to_string()).collect();
                Ok((true, children))
            } else {
                Ok((false, vec![]))
            }
        }
        _ => Err(SshError::ChannelError(format!("unsupported type: {typ}"))),
    }
}

/// Transfer one file, return bytes transferred.
async fn transfer_file(
    src_type: &str,
    src_session_id: &str,
    src_path: &str,
    dst_type: &str,
    dst_session_id: &str,
    dst_path: &str,
    sftp_manager: &SftpManager,
) -> Result<u64, SshError> {
    match (src_type, dst_type) {
        ("local", "local") => transfer_local_to_local(src_path, dst_path),
        ("local", "sftp") => transfer_local_to_sftp(src_path, dst_path, dst_session_id, sftp_manager).await,
        ("sftp", "local") => transfer_sftp_to_local(src_path, dst_path, src_session_id, sftp_manager).await,
        ("sftp", "sftp") => transfer_sftp_to_sftp(src_path, dst_path, src_session_id, dst_session_id, sftp_manager).await,
        _ => Err(SshError::ChannelError(format!("unsupported: {src_type} → {dst_type}"))),
    }
}

// ─── Transfer implementations ─────────────────────────────────────────────────

const CHUNK: usize = 64 * 1024;

fn transfer_local_to_local(src: &str, dst: &str) -> Result<u64, SshError> {
    if let Some(p) = std::path::Path::new(dst).parent() {
        if !p.as_os_str().is_empty() {
            std::fs::create_dir_all(p).map_err(|e| SshError::IoError(format!("mkdir {p:?}: {e}")))?;
        }
    }
    std::fs::copy(src, dst).map_err(|e| SshError::IoError(format!("copy {src} → {dst}: {e}")))
}

async fn transfer_local_to_sftp(
    src: &str,
    dst: &str,
    dst_session: &str,
    sftp_manager: &SftpManager,
) -> Result<u64, SshError> {
    let data = tokio::fs::read(src).await.map_err(|e| SshError::IoError(format!("read {src}: {e}")))?;
    let len = data.len() as u64;

    let session = sftp_manager.get_session(dst_session)
        .map_err(|e| SshError::ChannelError(format!("sftp session: {e}")))?;
    let sftp = session.sftp.lock().await;

    ensure_sftp_parent_dir(&sftp, dst).await?;

    let mut handle = sftp.open_with_flags(dst, OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE)
        .await.map_err(|e| SshError::ChannelError(format!("sftp create {dst}: {e}")))?;
    handle.write_all(&data).await.map_err(|e| SshError::ChannelError(format!("sftp write {dst}: {e}")))?;
    handle.shutdown().await.map_err(|e| SshError::ChannelError(format!("sftp close {dst}: {e}")))?;

    Ok(len)
}

async fn transfer_sftp_to_local(
    src: &str,
    dst: &str,
    src_session: &str,
    sftp_manager: &SftpManager,
) -> Result<u64, SshError> {
    let session = sftp_manager.get_session(src_session)
        .map_err(|e| SshError::ChannelError(format!("sftp session: {e}")))?;
    let sftp = session.sftp.lock().await;

    let mut handle = sftp.open(src).await.map_err(|e| SshError::ChannelError(format!("sftp open {src}: {e}")))?;
    let mut data = Vec::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = handle.read(&mut buf).await.map_err(|e| SshError::ChannelError(format!("sftp read {src}: {e}")))?;
        if n == 0 { break; }
        data.extend_from_slice(&buf[..n]);
    }
    handle.shutdown().await.ok();

    if let Some(p) = std::path::Path::new(dst).parent() {
        if !p.as_os_str().is_empty() {
            std::fs::create_dir_all(p).map_err(|e| SshError::IoError(format!("mkdir {p:?}: {e}")))?;
        }
    }
    tokio::fs::write(dst, &data).await.map_err(|e| SshError::IoError(format!("write {dst}: {e}")))?;

    Ok(data.len() as u64)
}

async fn transfer_sftp_to_sftp(
    src: &str,
    dst: &str,
    src_session: &str,
    dst_session: &str,
    sftp_manager: &SftpManager,
) -> Result<u64, SshError> {
    let src_session = sftp_manager.get_session(src_session)
        .map_err(|e| SshError::ChannelError(format!("sftp session: {e}")))?;
    let sftp_src = src_session.sftp.lock().await;
    let mut handle = sftp_src.open(src).await.map_err(|e| SshError::ChannelError(format!("sftp open {src}: {e}")))?;
    let mut data = Vec::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = handle.read(&mut buf).await.map_err(|e| SshError::ChannelError(format!("sftp read {src}: {e}")))?;
        if n == 0 { break; }
        data.extend_from_slice(&buf[..n]);
    }
    handle.shutdown().await.ok();
    drop(sftp_src);

    let dst_session = sftp_manager.get_session(dst_session)
        .map_err(|e| SshError::ChannelError(format!("sftp session: {e}")))?;
    let sftp_dst = dst_session.sftp.lock().await;
    ensure_sftp_parent_dir(&sftp_dst, dst).await?;

    let mut handle = sftp_dst.open_with_flags(dst, OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE)
        .await.map_err(|e| SshError::ChannelError(format!("sftp create {dst}: {e}")))?;
    handle.write_all(&data).await.map_err(|e| SshError::ChannelError(format!("sftp write {dst}: {e}")))?;
    handle.shutdown().await.map_err(|e| SshError::ChannelError(format!("sftp close {dst}: {e}")))?;

    Ok(data.len() as u64)
}

async fn ensure_sftp_parent_dir(
    sftp: &russh_sftp::client::SftpSession,
    path: &str,
) -> Result<(), SshError> {
    let parent = std::path::Path::new(path).parent();
    if let Some(p) = parent {
        let ps = p.to_string_lossy();
        if ps.is_empty() || ps == "/" { return Ok(()); }
        // Walk up and create missing ancestors
        let parts: Vec<&str> = ps.split('/').filter(|s| !s.is_empty()).collect();
        let mut current = String::new();
        for part in &parts {
            current.push('/');
            current.push_str(part);
            match sftp.create_dir(&current).await {
                Ok(()) | Err(_) => {} // Ignore "already exists" errors
            }
        }
    }
    Ok(())
}

fn emit(
    app: &AppHandle,
    transfer_id: &str,
    src_label: &SourceLabel,
    dst_label: &SourceLabel,
    status: CrossTransferStatus,
    bytes: u64,
    _total: u64,
    files: u32,
    files_total: u32,
) {
    let _ = app.emit("cross:transfer", CrossTransferEvent {
        transfer_id: transfer_id.to_string(),
        name: String::new(),
        src_label: src_label.display(),
        dst_label: dst_label.display(),
        status,
        error: None,
        bytes_transferred: bytes,
        total_bytes: 0,
        files_done: files,
        files_total,
        speed_bps: 0,
        eta_secs: None,
        created_at: now_ms(),
    });
}

// ─── Cancel command ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cross_cancel_transfer(transfer_id: String) -> Result<(), SshError> {
    if let Some(token) = CROSS_TRANSFERS.get(&transfer_id) {
        token.cancel();
        Ok(())
    } else {
        Err(SshError::SessionNotFound(transfer_id))
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_to_local_single_file() {
        let src = tempfile::tempdir().expect("tmp");
        let dst = tempfile::tempdir().expect("tmp");
        let sf = src.path().join("a.txt");
        std::fs::write(&sf, b"hello world").expect("write");

        let bytes = transfer_local_to_local(
            &sf.to_string_lossy(),
            &dst.path().join("a.txt").to_string_lossy(),
        ).expect("transfer");

        assert_eq!(bytes, 11);
        assert_eq!(
            std::fs::read_to_string(dst.path().join("a.txt")).expect("read"),
            "hello world"
        );
    }

    #[tokio::test]
    async fn local_to_local_creates_parent_dir() {
        let src = tempfile::tempdir().expect("tmp");
        let dst = tempfile::tempdir().expect("tmp");
        let sf = src.path().join("f.txt");
        std::fs::write(&sf, b"x").expect("write");

        transfer_local_to_local(
            &sf.to_string_lossy(),
            &dst.path().join("a/b/f.txt").to_string_lossy(),
        ).expect("transfer");

        assert!(dst.path().join("a/b/f.txt").exists());
    }
}
