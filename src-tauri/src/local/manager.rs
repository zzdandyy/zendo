use super::session::LocalSession;
use crate::types::{ConnectionStatus, SessionId, SshError, SshStatusPayload};
use dashmap::DashMap;
use tauri::{AppHandle, Emitter};

pub struct LocalSessionManager {
    sessions: DashMap<String, LocalSession>,
}

impl LocalSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }

    pub fn create(
        &self,
        app_handle: AppHandle,
        shell: Option<String>,
    ) -> Result<SessionId, SshError> {
        let session_id = SessionId::new();
        let sid = session_id.0.clone();

        let _ = app_handle.emit(
            "ssh:status",
            &SshStatusPayload {
                session_id: sid.clone(),
                status: ConnectionStatus::Connecting,
            },
        );

        let session = LocalSession::open(sid.clone(), 80, 24, app_handle, shell)?;
        self.sessions.insert(sid, session);

        Ok(session_id)
    }

    pub fn send_input(&self, session_id: &str, data: &[u8]) -> Result<(), SshError> {
        let entry = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SshError::SessionNotFound(session_id.to_string()))?;
        entry.value().send_input(data)
    }

    pub fn resize_pty(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), SshError> {
        let entry = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SshError::SessionNotFound(session_id.to_string()))?;
        entry.value().resize_pty(cols, rows)
    }

    pub async fn disconnect(
        &self,
        session_id: &str,
        app_handle: AppHandle,
    ) -> Result<(), SshError> {
        let _ = app_handle.emit(
            "ssh:status",
            &SshStatusPayload {
                session_id: session_id.to_string(),
                status: ConnectionStatus::Disconnecting,
            },
        );

        if let Some((_, session)) = self.sessions.remove(session_id) {
            session.disconnect().await?;
        } else {
            return Err(SshError::SessionNotFound(session_id.to_string()));
        }

        let _ = app_handle.emit(
            "ssh:status",
            &SshStatusPayload {
                session_id: session_id.to_string(),
                status: ConnectionStatus::Disconnected,
            },
        );

        Ok(())
    }
}
