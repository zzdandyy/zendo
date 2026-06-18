pub mod commands;
pub mod manager;
pub mod session;

use serde::{Deserialize, Serialize};

/// Filesystem entry returned by `local_list_dir`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub entry_type: LocalEntryType,
    pub size: u64,
    /// Unix mtime as seconds since epoch, or `None` when the OS reports none.
    pub modified: Option<u64>,
    /// Lower 12 bits of the mode word (Unix only; `None` on Windows).
    pub permissions: Option<u32>,
    /// Human-readable `rwxrwxrwx` string or `None` on Windows.
    pub permissions_display: Option<String>,
    pub is_symlink: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LocalEntryType {
    File,
    Directory,
}

/// Outcome of a recursive chmod.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChmodSummary {
    pub applied: u32,
    pub errors: Vec<String>,
}
