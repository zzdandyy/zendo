use super::{CrossTransferEvent, CrossTransferStatus, SourceLabel};
use crate::s3::S3Manager;
use crate::scp::{self, exec as scp_exec, ScpManager};
use crate::sftp::SftpManager;
use crate::types::SshError;
use dashmap::DashMap;
use russh_sftp::protocol::OpenFlags;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

static CROSS_TRANSFERS: std::sync::LazyLock<Arc<DashMap<String, CancellationToken>>> =
    std::sync::LazyLock::new(|| Arc::new(DashMap::new()));

const CHUNK: usize = 64 * 1024;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ─── Main command ────────────────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn cross_transfer(
    app_handle: AppHandle,
    sftp_manager: State<'_, Arc<SftpManager>>,
    scp_manager: State<'_, Arc<ScpManager>>,
    s3_manager: State<'_, Arc<S3Manager>>,
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
    let name = format!("{} → {}", src_label.display(), dst_label.display());

    let sftp_mgr = sftp_manager.inner().clone();
    let scp_mgr = scp_manager.inner().clone();
    let s3_mgr = s3_manager.inner().clone();

    tokio::spawn(async move {
        let result = run(
            &app,
            &sftp_mgr,
            &scp_mgr,
            &s3_mgr,
            &tid,
            &name,
            &src_type,
            &src_session_id,
            &src_paths,
            &dst_type,
            &dst_session_id,
            &dst_dir,
            &src_label,
            &dst_label,
            &cancel_token,
        )
        .await;

        let (bytes, total, files_done, files_total, speed) = match &result {
            Ok(stats) => (
                stats.bytes_transferred,
                stats.total_bytes,
                stats.files_done,
                stats.files_total,
                stats.speed_bps,
            ),
            Err(_) => (0, 0, 0, 0, 0),
        };

        let status = match result {
            Ok(_) => CrossTransferStatus::Completed,
            Err(_) if cancel_token.is_cancelled() => CrossTransferStatus::Cancelled,
            Err(_) => CrossTransferStatus::Failed,
        };
        let err_msg = result.as_ref().err().map(|e| e.to_string());

        let _ = app.emit(
            "cross:transfer",
            CrossTransferEvent {
                transfer_id: tid.clone(),
                name,
                src_label: src_label.display(),
                dst_label: dst_label.display(),
                status,
                error: err_msg,
                bytes_transferred: bytes,
                total_bytes: total,
                files_done,
                files_total,
                speed_bps: speed,
                eta_secs: None,
                created_at: now_ms(),
            },
        );

        CROSS_TRANSFERS.remove(&tid);
    });

    Ok(transfer_id)
}

fn parse_label(typ: &str, label: Option<String>) -> SourceLabel {
    match typ {
        "local" => SourceLabel::Local,
        "s3" => SourceLabel::S3(label.unwrap_or_else(|| "S3".into())),
        "scp" => SourceLabel::Host(label.unwrap_or_else(|| "Remote".into())),
        "sftp" => SourceLabel::Host(label.unwrap_or_else(|| "Remote".into())),
        _ => SourceLabel::Host(label.unwrap_or_else(|| "Remote".into())),
    }
}

// ─── Transfer stats ─────────────────────────────────────────────────────────

struct TransferStats {
    bytes_transferred: u64,
    total_bytes: u64,
    files_done: u32,
    files_total: u32,
    speed_bps: u64,
}

// ─── Core transfer logic ─────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn run(
    app: &AppHandle,
    sftp_manager: &SftpManager,
    scp_manager: &ScpManager,
    s3_manager: &S3Manager,
    transfer_id: &str,
    name: &str,
    src_type: &str,
    src_session_id: &str,
    src_paths: &[String],
    dst_type: &str,
    dst_session_id: &str,
    dst_dir: &str,
    src_label: &SourceLabel,
    dst_label: &SourceLabel,
    cancel: &CancellationToken,
) -> Result<TransferStats, SshError> {
    // ── Phase 1: walk source tree, collect file pairs with sizes ──────────
    let mut file_pairs: Vec<(String, String, u64)> = Vec::new();
    let mut stack: Vec<String> = src_paths.to_vec();

    while let Some(src_path) = stack.pop() {
        if cancel.is_cancelled() {
            return Err(SshError::Cancelled);
        }
        let (is_dir, children, size) = stat_entry(
            src_type,
            src_session_id,
            &src_path,
            sftp_manager,
            scp_manager,
            s3_manager,
        )
        .await?;

        if is_dir {
            for child in children {
                stack.push(format!("{src_path}/{child}"));
            }
        } else {
            let name = src_path.rsplit('/').next().unwrap_or(&src_path);
            let dst = if dst_dir.ends_with('/') {
                format!("{dst_dir}{name}")
            } else {
                format!("{dst_dir}/{name}")
            };
            file_pairs.push((src_path, dst, size));
        }
    }

    let files_total = file_pairs.len() as u32;
    let total_bytes: u64 = file_pairs.iter().map(|(_, _, s)| s).sum();
    let start = Instant::now();
    let mut bytes_done: u64 = 0;

    emit(
        app,
        transfer_id,
        name,
        src_label,
        dst_label,
        CrossTransferStatus::InProgress,
        0,
        total_bytes,
        0,
        files_total,
        0,
    );

    // ── Phase 2: transfer each file, reporting progress ──────────────────
    for (i, (src_path, dst_path, _size)) in file_pairs.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(SshError::Cancelled);
        }

        let chunk = transfer_file(
            src_type,
            src_session_id,
            src_path,
            dst_type,
            dst_session_id,
            dst_path,
            sftp_manager,
            scp_manager,
            s3_manager,
        )
        .await?;

        bytes_done += chunk;
        let files_done = (i + 1) as u32;
        let elapsed = start.elapsed().as_secs_f64().max(0.001);
        let speed = (bytes_done as f64 / elapsed) as u64;

        emit(
            app,
            transfer_id,
            name,
            src_label,
            dst_label,
            CrossTransferStatus::InProgress,
            bytes_done,
            total_bytes,
            files_done,
            files_total,
            speed,
        );
    }

    let elapsed = start.elapsed().as_secs_f64().max(0.001);
    let final_speed = if bytes_done > 0 {
        (bytes_done as f64 / elapsed) as u64
    } else {
        0
    };

    Ok(TransferStats {
        bytes_transferred: bytes_done,
        total_bytes,
        files_done: files_total,
        files_total,
        speed_bps: final_speed,
    })
}

/// Returns (is_dir, child_names, file_size_in_bytes).
/// For directories, children are the entry names; size is 0.
/// For files, children is empty; size is the file size.
async fn stat_entry(
    typ: &str,
    session_id: &str,
    path: &str,
    sftp_manager: &SftpManager,
    scp_manager: &ScpManager,
    s3_manager: &S3Manager,
) -> Result<(bool, Vec<String>, u64), SshError> {
    match typ {
        "local" => {
            let meta = std::fs::symlink_metadata(path)
                .map_err(|e| SshError::IoError(format!("{path}: {e}")))?;
            if meta.is_dir() {
                let mut children = Vec::new();
                if let Ok(rd) = std::fs::read_dir(path) {
                    for e in rd.flatten() {
                        children.push(e.file_name().to_string_lossy().to_string());
                    }
                }
                Ok((true, children, 0))
            } else {
                Ok((false, vec![], meta.len()))
            }
        }
        "sftp" => {
            let session = sftp_manager
                .get_session(session_id)
                .map_err(|e| SshError::ChannelError(format!("sftp session: {e}")))?;
            let sftp = session.sftp.lock().await;
            let meta = sftp
                .metadata(path)
                .await
                .map_err(|e| SshError::ChannelError(format!("sftp stat {path}: {e}")))?;
            if meta.is_dir() {
                let list = sftp
                    .read_dir(path)
                    .await
                    .map_err(|e| SshError::ChannelError(format!("sftp read_dir {path}: {e}")))?;
                let children: Vec<String> = list.map(|f| f.file_name().to_string()).collect();
                Ok((true, children, 0))
            } else {
                Ok((false, vec![], meta.size.unwrap_or(0)))
            }
        }
        "scp" => {
            let session = scp_manager
                .get_session(session_id)
                .map_err(|e| SshError::ChannelError(format!("scp session: {e}")))?;
            let stat = scp_exec::stat(session.ssh_handle.clone(), session.flavor, path)
                .await
                .map_err(|e| SshError::ChannelError(format!("scp stat {path}: {e}")))?
                .ok_or_else(|| SshError::ChannelError(format!("scp: {path} not found")))?;

            if stat.entry_type == scp::ScpEntryType::Directory {
                let entries = scp_exec::list_dir(session.ssh_handle.clone(), session.flavor, path)
                    .await
                    .map_err(|e| SshError::ChannelError(format!("scp list_dir {path}: {e}")))?;
                let children: Vec<String> = entries.into_iter().map(|e| e.name).collect();
                Ok((true, children, 0))
            } else {
                Ok((false, vec![], stat.size))
            }
        }
        "s3" => {
            let bucket = s3_manager
                .get_bucket(session_id)
                .map_err(|e| SshError::ChannelError(format!("s3 bucket: {e}")))?;
            // List objects with the path as prefix, delimiter '/' to discover
            // immediate children (both "files" = objects at this prefix, and
            // "folders" = common prefixes).
            let results = bucket
                .list(path.to_string(), Some("/".to_string()))
                .await
                .map_err(|e| SshError::ChannelError(format!("s3 list {path}: {e}")))?;

            let mut children: Vec<String> = Vec::new();
            let mut has_objects = false;

            for result in &results {
                for obj in &result.contents {
                    let key = &obj.key;
                    // Skip the exact prefix match (the directory marker itself)
                    if key == path || (key.ends_with('/') && key.trim_end_matches('/') == path) {
                        continue;
                    }
                    let name = key
                        .strip_prefix(path)
                        .and_then(|s| s.strip_prefix('/'))
                        .unwrap_or(key);
                    // If the name contains '/', it's a deeper object — skip for
                    // immediate listing.
                    if name.contains('/') {
                        continue;
                    }
                    if !name.is_empty() {
                        has_objects = true;
                        children.push(name.to_string());
                    }
                }
                if let Some(ref prefixes) = result.common_prefixes {
                    for cp in prefixes {
                        let name = cp
                            .prefix
                            .strip_prefix(path)
                            .and_then(|s| s.strip_prefix('/'))
                            .unwrap_or(&cp.prefix);
                        let name = name.trim_end_matches('/');
                        if !name.is_empty() {
                            children.push(name.to_string());
                        }
                    }
                }
            }

            if children.is_empty() && !has_objects {
                // The path itself is a single object (file)
                match bucket.head_object(path).await {
                    Ok((head, _)) => {
                        let size = head.content_length.unwrap_or(0) as u64;
                        return Ok((false, vec![], size));
                    }
                    Err(_) => {
                        return Err(SshError::ChannelError(format!("s3: {path} not found")));
                    }
                }
            }

            Ok((true, children, 0))
        }
        _ => Err(SshError::ChannelError(format!(
            "unsupported source type: {typ}"
        ))),
    }
}

/// Transfer one file, return bytes transferred. The file is streamed in
/// 64 KB chunks — no whole-file buffering.
async fn transfer_file(
    src_type: &str,
    src_session_id: &str,
    src_path: &str,
    dst_type: &str,
    dst_session_id: &str,
    dst_path: &str,
    sftp_manager: &SftpManager,
    scp_manager: &ScpManager,
    s3_manager: &S3Manager,
) -> Result<u64, SshError> {
    match (src_type, dst_type) {
        ("local", "local") => transfer_local_to_local(src_path, dst_path),
        ("local", "sftp") => {
            transfer_local_to_sftp(src_path, dst_path, dst_session_id, sftp_manager).await
        }
        ("sftp", "local") => {
            transfer_sftp_to_local(src_path, dst_path, src_session_id, sftp_manager).await
        }
        ("sftp", "sftp") => {
            transfer_sftp_to_sftp(
                src_path,
                dst_path,
                src_session_id,
                dst_session_id,
                sftp_manager,
            )
            .await
        }
        ("local", "scp") => {
            transfer_local_to_scp(src_path, dst_path, dst_session_id, scp_manager).await
        }
        ("scp", "local") => {
            transfer_scp_to_local(src_path, dst_path, src_session_id, scp_manager).await
        }
        ("local", "s3") => {
            transfer_local_to_s3(src_path, dst_path, dst_session_id, s3_manager).await
        }
        ("s3", "local") => {
            transfer_s3_to_local(src_path, dst_path, src_session_id, s3_manager).await
        }
        _ => Err(SshError::ChannelError(format!(
            "unsupported cross-transfer: {src_type} → {dst_type}"
        ))),
    }
}

// ─── Transfer implementations ─────────────────────────────────────────────────

// ── local ↔ local ─────────────────────────────────────────────────────────

fn transfer_local_to_local(src: &str, dst: &str) -> Result<u64, SshError> {
    if let Some(p) = std::path::Path::new(dst).parent() {
        if !p.as_os_str().is_empty() {
            std::fs::create_dir_all(p)
                .map_err(|e| SshError::IoError(format!("mkdir {p:?}: {e}")))?;
        }
    }
    let len = std::fs::metadata(src)
        .map_err(|e| SshError::IoError(format!("stat {src}: {e}")))?
        .len();
    std::fs::copy(src, dst).map_err(|e| SshError::IoError(format!("copy {src} → {dst}: {e}")))?;
    Ok(len)
}

// ── local → sftp (streaming) ──────────────────────────────────────────────

async fn transfer_local_to_sftp(
    src: &str,
    dst: &str,
    dst_session: &str,
    sftp_manager: &SftpManager,
) -> Result<u64, SshError> {
    let mut local_file = tokio::fs::File::open(src)
        .await
        .map_err(|e| SshError::IoError(format!("open {src}: {e}")))?;

    let session = sftp_manager
        .get_session(dst_session)
        .map_err(|e| SshError::ChannelError(format!("sftp session: {e}")))?;
    let sftp = session.sftp.lock().await;

    ensure_sftp_parent_dir(&sftp, dst).await?;

    let mut handle = sftp
        .open_with_flags(
            dst,
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
        )
        .await
        .map_err(|e| SshError::ChannelError(format!("sftp create {dst}: {e}")))?;

    let mut total: u64 = 0;
    let mut buf = vec![0u8; CHUNK];

    let stream_result = async {
        loop {
            let n = local_file
                .read(&mut buf)
                .await
                .map_err(|e| SshError::IoError(format!("read {src}: {e}")))?;
            if n == 0 {
                break;
            }
            handle
                .write_all(&buf[..n])
                .await
                .map_err(|e| SshError::ChannelError(format!("sftp write {dst}: {e}")))?;
            total += n as u64;
        }
        Ok::<_, SshError>(())
    }
    .await;

    if let Err(e) = stream_result {
        // Clean up partial remote file on failure.
        let _ = handle.shutdown().await;
        let sftp = session.sftp.lock().await;
        let _ = sftp.remove_file(dst).await;
        return Err(e);
    }

    handle
        .shutdown()
        .await
        .map_err(|e| SshError::ChannelError(format!("sftp close {dst}: {e}")))?;

    Ok(total)
}

// ── sftp → local (streaming) ──────────────────────────────────────────────

async fn transfer_sftp_to_local(
    src: &str,
    dst: &str,
    src_session: &str,
    sftp_manager: &SftpManager,
) -> Result<u64, SshError> {
    let session = sftp_manager
        .get_session(src_session)
        .map_err(|e| SshError::ChannelError(format!("sftp session: {e}")))?;
    let sftp = session.sftp.lock().await;

    let mut handle = sftp
        .open(src)
        .await
        .map_err(|e| SshError::ChannelError(format!("sftp open {src}: {e}")))?;

    if let Some(p) = std::path::Path::new(dst).parent() {
        if !p.as_os_str().is_empty() {
            std::fs::create_dir_all(p)
                .map_err(|e| SshError::IoError(format!("mkdir {p:?}: {e}")))?;
        }
    }

    let mut local_file = tokio::fs::File::create(dst)
        .await
        .map_err(|e| SshError::IoError(format!("create {dst}: {e}")))?;

    let mut total: u64 = 0;
    let mut buf = vec![0u8; CHUNK];

    let stream_result = async {
        loop {
            let n = handle
                .read(&mut buf)
                .await
                .map_err(|e| SshError::ChannelError(format!("sftp read {src}: {e}")))?;
            if n == 0 {
                break;
            }
            local_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| SshError::IoError(format!("write {dst}: {e}")))?;
            total += n as u64;
        }
        Ok::<_, SshError>(())
    }
    .await;

    if let Err(e) = stream_result {
        drop(local_file);
        let _ = tokio::fs::remove_file(dst).await;
        handle.shutdown().await.ok();
        return Err(e);
    }

    handle.shutdown().await.ok();
    local_file
        .flush()
        .await
        .map_err(|e| SshError::IoError(format!("flush {dst}: {e}")))?;

    Ok(total)
}

// ── sftp → sftp (streaming, no local disk) ────────────────────────────────

async fn transfer_sftp_to_sftp(
    src: &str,
    dst: &str,
    src_session: &str,
    dst_session: &str,
    sftp_manager: &SftpManager,
) -> Result<u64, SshError> {
    let src_session_ref = sftp_manager
        .get_session(src_session)
        .map_err(|e| SshError::ChannelError(format!("sftp session: {e}")))?;
    let sftp_src = src_session_ref.sftp.lock().await;
    let mut handle = sftp_src
        .open(src)
        .await
        .map_err(|e| SshError::ChannelError(format!("sftp open {src}: {e}")))?;

    let dst_session_ref = sftp_manager
        .get_session(dst_session)
        .map_err(|e| SshError::ChannelError(format!("sftp session: {e}")))?;
    let sftp_dst = dst_session_ref.sftp.lock().await;
    ensure_sftp_parent_dir(&sftp_dst, dst).await?;

    let mut dst_handle = sftp_dst
        .open_with_flags(
            dst,
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
        )
        .await
        .map_err(|e| SshError::ChannelError(format!("sftp create {dst}: {e}")))?;

    let mut total: u64 = 0;
    let mut buf = vec![0u8; CHUNK];

    let stream_result = async {
        loop {
            let n = handle
                .read(&mut buf)
                .await
                .map_err(|e| SshError::ChannelError(format!("sftp read {src}: {e}")))?;
            if n == 0 {
                break;
            }
            dst_handle
                .write_all(&buf[..n])
                .await
                .map_err(|e| SshError::ChannelError(format!("sftp write {dst}: {e}")))?;
            total += n as u64;
        }
        Ok::<_, SshError>(())
    }
    .await;

    if let Err(e) = stream_result {
        let _ = dst_handle.shutdown().await;
        // Re-acquire lock for cleanup
        drop(sftp_dst);
        let sftp_dst2 = dst_session_ref.sftp.lock().await;
        let _ = sftp_dst2.remove_file(dst).await;
        handle.shutdown().await.ok();
        return Err(e);
    }

    handle.shutdown().await.ok();
    dst_handle
        .shutdown()
        .await
        .map_err(|e| SshError::ChannelError(format!("sftp close {dst}: {e}")))?;

    Ok(total)
}

// ── local → scp ───────────────────────────────────────────────────────────

async fn transfer_local_to_scp(
    src: &str,
    dst: &str,
    dst_session: &str,
    scp_manager: &ScpManager,
) -> Result<u64, SshError> {
    let session = scp_manager
        .get_session(dst_session)
        .map_err(|e| SshError::ChannelError(format!("scp session: {e}")))?;
    let handle = session.ssh_handle.clone();

    // Ensure remote parent directory exists.
    if let Some(parent) = std::path::Path::new(dst).parent() {
        let p = parent.to_string_lossy();
        if !p.is_empty() && p != "/" {
            scp_exec::mkdir_p(handle.clone(), &p)
                .await
                .map_err(|e| SshError::ChannelError(format!("scp mkdir {p}: {e}")))?;
        }
    }

    let local_meta = tokio::fs::metadata(src)
        .await
        .map_err(|e| SshError::IoError(format!("stat {src}: {e}")))?;
    let size = local_meta.len();
    let cancel = CancellationToken::new();

    scp::transfer::upload_file(
        handle,
        std::path::Path::new(src),
        dst,
        &cancel,
        |_| {}, // progress tracked at file level
    )
    .await
    .map_err(|e| SshError::ChannelError(format!("scp upload {src} → {dst}: {e}")))?;

    Ok(size)
}

// ── scp → local ───────────────────────────────────────────────────────────

async fn transfer_scp_to_local(
    src: &str,
    dst: &str,
    src_session: &str,
    scp_manager: &ScpManager,
) -> Result<u64, SshError> {
    let session = scp_manager
        .get_session(src_session)
        .map_err(|e| SshError::ChannelError(format!("scp session: {e}")))?;
    let handle = session.ssh_handle.clone();

    if let Some(p) = std::path::Path::new(dst).parent() {
        if !p.as_os_str().is_empty() {
            std::fs::create_dir_all(p)
                .map_err(|e| SshError::IoError(format!("mkdir {p:?}: {e}")))?;
        }
    }

    let cancel = CancellationToken::new();

    scp::transfer::download_file(handle, src, std::path::Path::new(dst), &cancel, |_| {})
        .await
        .map_err(|e| SshError::ChannelError(format!("scp download {src} → {dst}: {e}")))?;

    let local_meta =
        std::fs::metadata(dst).map_err(|e| SshError::IoError(format!("stat {dst}: {e}")))?;
    Ok(local_meta.len())
}

// ── local → s3 ────────────────────────────────────────────────────────────

async fn transfer_local_to_s3(
    src: &str,
    dst: &str,
    dst_session: &str,
    s3_manager: &S3Manager,
) -> Result<u64, SshError> {
    let bucket = s3_manager
        .get_bucket(dst_session)
        .map_err(|e| SshError::ChannelError(format!("s3 bucket: {e}")))?;

    let data = tokio::fs::read(src)
        .await
        .map_err(|e| SshError::IoError(format!("read {src}: {e}")))?;
    let len = data.len() as u64;

    bucket
        .put_object(dst, &data)
        .await
        .map_err(|e| SshError::ChannelError(format!("s3 PUT {dst}: {e}")))?;

    Ok(len)
}

// ── s3 → local ────────────────────────────────────────────────────────────

async fn transfer_s3_to_local(
    src: &str,
    dst: &str,
    src_session: &str,
    s3_manager: &S3Manager,
) -> Result<u64, SshError> {
    let bucket = s3_manager
        .get_bucket(src_session)
        .map_err(|e| SshError::ChannelError(format!("s3 bucket: {e}")))?;

    let response = bucket
        .get_object(src)
        .await
        .map_err(|e| SshError::ChannelError(format!("s3 GET {src}: {e}")))?;
    let data = response.bytes().to_vec();
    let len = data.len() as u64;

    if let Some(p) = std::path::Path::new(dst).parent() {
        if !p.as_os_str().is_empty() {
            std::fs::create_dir_all(p)
                .map_err(|e| SshError::IoError(format!("mkdir {p:?}: {e}")))?;
        }
    }

    tokio::fs::write(dst, &data)
        .await
        .map_err(|e| SshError::IoError(format!("write {dst}: {e}")))?;

    Ok(len)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async fn ensure_sftp_parent_dir(
    sftp: &russh_sftp::client::SftpSession,
    path: &str,
) -> Result<(), SshError> {
    let parent = std::path::Path::new(path).parent();
    if let Some(p) = parent {
        let ps = p.to_string_lossy();
        if ps.is_empty() || ps == "/" {
            return Ok(());
        }
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

#[allow(clippy::too_many_arguments)]
fn emit(
    app: &AppHandle,
    transfer_id: &str,
    name: &str,
    src_label: &SourceLabel,
    dst_label: &SourceLabel,
    status: CrossTransferStatus,
    bytes: u64,
    total: u64,
    files: u32,
    files_total: u32,
    speed: u64,
) {
    let eta = if speed > 0 && total > bytes {
        Some((total - bytes) / speed)
    } else {
        None
    };

    let _ = app.emit(
        "cross:transfer",
        CrossTransferEvent {
            transfer_id: transfer_id.to_string(),
            name: name.to_string(),
            src_label: src_label.display(),
            dst_label: dst_label.display(),
            status,
            error: None,
            bytes_transferred: bytes,
            total_bytes: total,
            files_done: files,
            files_total,
            speed_bps: speed,
            eta_secs: eta,
            created_at: now_ms(),
        },
    );
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
        )
        .expect("transfer");

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
        )
        .expect("transfer");

        assert!(dst.path().join("a/b/f.txt").exists());
    }
}
