use crate::sftp::format_permissions;
use crate::types::{SessionId, SshError};
use super::manager::LocalSessionManager;
use super::LocalEntry;
use super::LocalEntryType;
use super::LocalChmodSummary;
use tauri::{AppHandle, State};

// ─── Terminal (existing) ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn local_terminal_create(
    state: State<'_, LocalSessionManager>,
    app_handle: AppHandle,
) -> Result<SessionId, SshError> {
    state.create(app_handle, None)
}

// ─── File operations ─────────────────────────────────────────────────────────

/// Basic path safety: reject empty, relative, or `..`-traversal paths.
/// No home-directory sandbox — the user can browse the entire filesystem.
fn validate_local_path(path: &str) -> Result<(), SshError> {
    if path.is_empty() {
        return Err(SshError::ChannelError("path is empty".into()));
    }
    if !path.starts_with('/') {
        return Err(SshError::ChannelError("path must be absolute".into()));
    }
    if path.contains("..") {
        return Err(SshError::ChannelError("path must not contain ..".into()));
    }
    // Canonicalise to resolve symlinks (no home-dir sandbox).
    // If the path doesn't exist yet (mkdir / create_file), walk up to find
    // an existing ancestor and canonicalise that.
    let mut check = std::path::Path::new(path);
    loop {
        match std::fs::canonicalize(check) {
            Ok(_) => return Ok(()),
            Err(_) => {
                if let Some(p) = check.parent() {
                    if p.as_os_str().is_empty() {
                        return Ok(()); // reached root
                    }
                    check = p;
                } else {
                    return Ok(());
                }
            }
        }
    }
}

fn home_dir() -> Result<String, SshError> {
    dirs::home_dir()
        .map(|h| h.to_string_lossy().to_string())
        .ok_or_else(|| SshError::ChannelError("cannot determine home directory".into()))
}

// ─── List directory ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn local_list_dir(path: Option<String>) -> Result<Vec<LocalEntry>, SshError> {
    let home = home_dir()?;
    let dir = path.unwrap_or_else(|| home.clone());
    validate_local_path(&dir)?;

    let mut entries: Vec<LocalEntry> = Vec::new();

    let read_dir = std::fs::read_dir(&dir).map_err(|e| {
        SshError::ChannelError(format!("cannot read directory {dir}: {e}"))
    })?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();
        let abs_path = entry.path().to_string_lossy().to_string();
        let is_dir = metadata.is_dir();

        let (permissions, permissions_display): (Option<u32>, Option<String>) = {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = metadata.permissions().mode() & 0o7777;
                (Some(mode), Some(format_permissions(mode & 0o777)))
            }
            #[cfg(not(unix))]
            {
                (None, None)
            }
        };

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());

        entries.push(LocalEntry {
            name,
            path: abs_path,
            entry_type: if is_dir {
                LocalEntryType::Directory
            } else {
                LocalEntryType::File
            },
            size: metadata.len(),
            modified,
            permissions,
            permissions_display,
            is_symlink: metadata.is_symlink(),
        });
    }

    // Sort: directories first, then alphabetically.
    entries.sort_by(|a, b| {
        use LocalEntryType::*;
        let a_is_dir = matches!(a.entry_type, Directory);
        let b_is_dir = matches!(b.entry_type, Directory);
        b_is_dir
            .cmp(&a_is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

// ─── Home directory ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn local_home_dir() -> Result<String, SshError> {
    home_dir()
}

// ─── Create directory (mkdir -p) ─────────────────────────────────────────────

#[tauri::command]
pub async fn local_mkdir(path: String) -> Result<(), SshError> {
    validate_local_path(&path)?;
    std::fs::create_dir_all(&path)
        .map_err(|e| SshError::ChannelError(format!("mkdir failed for {path}: {e}")))
}

// ─── Create empty file (touch) ───────────────────────────────────────────────

#[tauri::command]
pub async fn local_create_file(path: String) -> Result<(), SshError> {
    validate_local_path(&path)?;
    // Ensure parent directory exists.
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| SshError::ChannelError(format!("mkdir -p parent failed: {e}")))?;
        }
    }
    std::fs::File::create(&path)
        .map_err(|e| SshError::ChannelError(format!("touch failed for {path}: {e}")))?;
    Ok(())
}

// ─── Delete ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn local_delete(paths: Vec<String>) -> Result<(), SshError> {
    for path in &paths {
        validate_local_path(path)?;
        let p = std::path::Path::new(path);
        if p.is_dir() {
            std::fs::remove_dir_all(p)
                .map_err(|e| SshError::ChannelError(format!("rm -rf failed for {path}: {e}")))?;
        } else {
            std::fs::remove_file(p)
                .map_err(|e| SshError::ChannelError(format!("rm failed for {path}: {e}")))?;
        }
    }
    Ok(())
}

// ─── Rename / move ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn local_rename(old_path: String, new_path: String) -> Result<(), SshError> {
    validate_local_path(&old_path)?;
    validate_local_path(&new_path)?;
    // Ensure the parent of new_path exists.
    if let Some(parent) = std::path::Path::new(&new_path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| SshError::ChannelError(format!("mkdir -p parent failed: {e}")))?;
        }
    }
    std::fs::rename(&old_path, &new_path)
        .map_err(|e| SshError::ChannelError(format!("rename {old_path} -> {new_path}: {e}")))
}

// ─── Chmod ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn local_chmod(path: String, mode: u32) -> Result<(), SshError> {
    #[cfg(not(unix))]
    {
        let _ = (path, mode);
        return Err(SshError::ChannelError("chmod is not supported on this platform".into()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        validate_local_path(&path)?;
        let perm = std::fs::Permissions::from_mode(mode);
        std::fs::set_permissions(&path, perm)
            .map_err(|e| SshError::ChannelError(format!("chmod {path}: {e}")))
    }
}

#[tauri::command]
pub async fn local_chmod_recursive(path: String, mode: u32) -> Result<LocalChmodSummary, SshError> {
    #[cfg(not(unix))]
    {
        let _ = (path, mode);
        return Err(SshError::ChannelError("chmod is not supported on this platform".into()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        validate_local_path(&path)?;

        let mut applied: u32 = 0;
        let mut errors: Vec<String> = Vec::new();

        // Collect all entries (breadth-first), then apply leaves-first so
        // removing a directory's execute bit doesn't block reading its children.
        let mut all: Vec<String> = Vec::new();
        let mut stack: Vec<String> = vec![path.clone()];
        const MAX_DEPTH: u32 = 64;

        while let Some(dir) = stack.pop() {
            all.push(dir.clone());
            if let Ok(read_dir) = std::fs::read_dir(&dir) {
                for entry in read_dir.flatten() {
                    let p = entry.path().to_string_lossy().to_string();
                    if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                        if all.len() + stack.len() > MAX_DEPTH as usize * 1000 {
                            errors.push(format!("{p}: max depth exceeded"));
                            continue;
                        }
                        stack.push(p);
                    } else {
                        all.push(p);
                    }
                }
            }
        }

        // Apply leaves-first (reverse of BFS order — directories are processed
        // after their contents).
        let perm = std::fs::Permissions::from_mode(mode);
        for p in all.iter().rev() {
            if let Err(e) = std::fs::set_permissions(p, perm.clone()) {
                errors.push(format!("{p}: {e}"));
            } else {
                applied += 1;
            }
        }

        Ok(LocalChmodSummary { applied, errors })
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home() -> (tempfile::TempDir, String) {
        // Use a subdirectory of $HOME so test paths resolve cleanly.
        let test_root = dirs::home_dir()
            .expect("home_dir")
            .join(".zendo-tests");
        let _ = std::fs::create_dir_all(&test_root);
        let d = tempfile::tempdir_in(&test_root).expect("tempdir_in");
        let home = d.path().to_string_lossy().to_string();
        (d, home)
    }

    fn setup_file(home: &str, rel: &str, content: &str) -> String {
        let path = format!("{home}/{rel}");
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent).expect("create_dir_all");
        }
        std::fs::write(&path, content).expect("write");
        path
    }

    fn setup_dir(home: &str, rel: &str) -> String {
        let path = format!("{home}/{rel}");
        std::fs::create_dir_all(&path).expect("create_dir_all");
        path
    }

    // ── validate_local_path ────────────────────────────────────────────────

    #[test]
    fn validate_allows_absolute_path() {
        let (_d, home) = temp_home();
        setup_file(&home, "a/b.txt", "");
        validate_local_path(&format!("{home}/a/b.txt")).expect("should pass");
    }

    #[test]
    fn validate_rejects_dotdot() {
        assert!(validate_local_path("/etc/../passwd").is_err());
    }

    #[test]
    fn validate_rejects_relative() {
        assert!(validate_local_path("foo/bar").is_err());
    }

    #[test]
    fn validate_allows_non_existent_path() {
        let (_d, home) = temp_home();
        validate_local_path(&format!("{home}/does/not/exist/yet")).expect("should pass");
    }

    #[test]
    fn validate_allows_root() {
        validate_local_path("/").expect("root should be allowed");
    }

    #[test]
    fn validate_allows_etc() {
        validate_local_path("/etc").expect("system paths should be allowed");
    }

    // ── local_list_dir ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_dir_sorts_dirs_first() {
        let (_d, home) = temp_home();
        setup_file(&home, "z_file.txt", "");
        setup_dir(&home, "a_dir");
        setup_file(&home, "m_file.txt", "");

        // We list `home` itself, which contains our tempdir structure.
        // Instead list a subdirectory we control fully.
        setup_dir(&home, "test");
        setup_file(&home, "test/z_file.txt", "z");
        setup_dir(&home, "test/subdir");
        setup_file(&home, "test/a_file.txt", "a");

        let entries = local_list_dir(Some(format!("{home}/test"))).await.expect("list");
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        // Directories first.
        let subdir_idx = names.iter().position(|n| *n == "subdir").expect("subdir");
        let z_idx = names.iter().position(|n| *n == "z_file.txt").expect("z_file");
        assert!(subdir_idx < z_idx, "dirs must come before files");
    }

    #[tokio::test]
    async fn list_dir_returns_empty_for_empty_dir() {
        let (_d, home) = temp_home();
        setup_dir(&home, "empty");
        let entries = local_list_dir(Some(format!("{home}/empty"))).await.expect("list");
        assert!(entries.is_empty());
    }

    #[tokio::test]
    async fn list_dir_error_on_non_existent() {
        let (_d, home) = temp_home();
        let result = local_list_dir(Some(format!("{home}/nope"))).await;
        assert!(result.is_err());
    }

    // ── local_mkdir ─────────────────────────────────────────────────────────

    #[tokio::test]
    async fn mkdir_creates_dir() {
        let (_d, home) = temp_home();
        let dir = format!("{home}/new_dir");
        local_mkdir(dir.clone()).await.expect("mkdir");
        assert!(std::path::Path::new(&dir).is_dir());
    }

    #[tokio::test]
    async fn mkdir_p_creates_parents() {
        let (_d, home) = temp_home();
        let dir = format!("{home}/a/b/c");
        local_mkdir(dir.clone()).await.expect("mkdir -p");
        assert!(std::path::Path::new(&dir).is_dir());
    }

    #[tokio::test]
    async fn mkdir_existing_is_ok() {
        let (_d, home) = temp_home();
        let dir = format!("{home}/d");
        std::fs::create_dir(&dir).expect("create_dir");
        local_mkdir(dir).await.expect("mkdir existing should be ok");
    }

    // ── local_create_file ───────────────────────────────────────────────────

    #[tokio::test]
    async fn create_file_works() {
        let (_d, home) = temp_home();
        let f = format!("{home}/f.txt");
        local_create_file(f.clone()).await.expect("create_file");
        assert!(std::path::Path::new(&f).is_file());
    }

    #[tokio::test]
    async fn create_file_creates_parents() {
        let (_d, home) = temp_home();
        let f = format!("{home}/x/y/z.txt");
        local_create_file(f.clone()).await.expect("create_file");
        assert!(std::path::Path::new(&f).is_file());
    }

    // ── local_delete ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn delete_single_file() {
        let (_d, home) = temp_home();
        let f = setup_file(&home, "rm_me.txt", "");
        local_delete(vec![f.clone()]).await.expect("delete");
        assert!(!std::path::Path::new(&f).exists());
    }

    #[tokio::test]
    async fn delete_recursive_dir() {
        let (_d, home) = temp_home();
        let d = setup_dir(&home, "rm_dir");
        setup_file(&home, "rm_dir/a.txt", "");
        local_delete(vec![d.clone()]).await.expect("delete");
        assert!(!std::path::Path::new(&d).exists());
    }

    // ── local_rename ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn rename_in_place() {
        let (_d, home) = temp_home();
        let old = setup_file(&home, "old.txt", "hello");
        let new = format!("{home}/new.txt");
        local_rename(old.clone(), new.clone()).await.expect("rename");
        assert!(!std::path::Path::new(&old).exists());
        assert!(std::path::Path::new(&new).exists());
        assert_eq!(std::fs::read_to_string(&new).unwrap(), "hello");
    }

    #[tokio::test]
    async fn rename_across_dirs() {
        let (_d, home) = temp_home();
        setup_dir(&home, "dst");
        let old = setup_file(&home, "src.txt", "move me");
        let new = format!("{home}/dst/src.txt");
        local_rename(old.clone(), new.clone()).await.expect("rename");
        assert!(!std::path::Path::new(&old).exists());
        assert_eq!(std::fs::read_to_string(&new).unwrap(), "move me");
    }

    // ── local_home_dir ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn home_dir_returns_a_directory() {
        let h = local_home_dir().await.expect("home_dir");
        assert!(std::path::Path::new(&h).is_dir());
    }

    // ── local_chmod (Unix only) ─────────────────────────────────────────────

    #[cfg(unix)]
    #[tokio::test]
    async fn chmod_sets_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let (_d, home) = temp_home();
        let f = setup_file(&home, "chmod_test.txt", "");
        local_chmod(f.clone(), 0o600).await.expect("chmod");
        let m = std::fs::metadata(&f).expect("metadata");
        assert_eq!(m.permissions().mode() & 0o777, 0o600);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn chmod_recursive_applies_to_tree() {
        let (_d, home) = temp_home();
        let dir = setup_dir(&home, "chmod_tree");
        setup_file(&home, "chmod_tree/a.txt", "");
        setup_file(&home, "chmod_tree/b.txt", "");
        setup_dir(&home, "chmod_tree/sub");
        setup_file(&home, "chmod_tree/sub/c.txt", "");

        let summary = local_chmod_recursive(dir.clone(), 0o400).await.expect("chmod -R");
        // 1 dir + 3 files = 4 entries (no sub dir entry? actually: dir + a + b + sub + c = 5)
        assert!(summary.applied >= 4, "should apply to at least 4 entries, got {}", summary.applied);
        assert!(summary.errors.is_empty(), "no errors expected");
    }
}
