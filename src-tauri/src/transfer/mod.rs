pub mod commands;

use serde::{Deserialize, Serialize};

/// Event emitted on the `cross:transfer` channel during cross-pane transfers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossTransferEvent {
    pub transfer_id: String,
    pub name: String,
    pub src_label: String,
    pub dst_label: String,
    pub status: CrossTransferStatus,
    pub error: Option<String>,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub files_done: u32,
    pub files_total: u32,
    pub speed_bps: u64,
    pub eta_secs: Option<u64>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CrossTransferStatus {
    Queued,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

/// Simple label for a pane source.
#[derive(Debug, Clone)]
pub enum SourceLabel {
    Local,
    Host(String),
    S3(String),
}

impl SourceLabel {
    pub fn display(&self) -> String {
        match self {
            SourceLabel::Local => "Local".into(),
            SourceLabel::Host(l) => l.clone(),
            SourceLabel::S3(l) => l.clone(),
        }
    }
}
