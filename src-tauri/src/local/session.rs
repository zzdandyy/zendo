use crate::types::{ConnectionStatus, SshError, SshOutputPayload, SshStatusPayload};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Write;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

enum SessionCmd {
    Data(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Eof,
}

pub struct LocalSession {
    cmd_tx: mpsc::UnboundedSender<SessionCmd>,
    reader_task: tokio::task::JoinHandle<()>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

impl LocalSession {
    pub fn open(
        session_id: String,
        cols: u16,
        rows: u16,
        app_handle: AppHandle,
        shell: Option<String>,
    ) -> Result<Self, SshError> {
        // 1. Create PTY pair
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| SshError::ChannelError(format!("failed to create PTY: {e}")))?;

        // 2. Determine shell path
        let shell_path = shell
            .unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string()));

        // 3. Spawn the shell in the PTY slave
        let mut cmd = CommandBuilder::new(&shell_path);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| SshError::ChannelError(format!("failed to spawn shell: {e}")))?;
        let child = Arc::new(Mutex::new(child));

        // 4. Split master into reader + writer (both moved into the async task)
        let master = pair.master;
        let mut reader = master
            .try_clone_reader()
            .map_err(|e| SshError::ChannelError(format!("failed to clone PTY reader: {e}")))?;
        let mut writer = master
            .take_writer()
            .map_err(|e| SshError::ChannelError(format!("failed to take PTY writer: {e}")))?;

        // 5. Channels
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SessionCmd>();
        let (output_tx, mut output_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        // 6. Dedicated OS thread for blocking PTY reads
        let reader_tx = output_tx.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF — child closed
                    Ok(n) => {
                        if reader_tx.send(buf[..n].to_vec()).is_err() {
                            break; // Receiver dropped
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // 7. Async task: multiplex between output delivery and frontend commands
        let reader_session_id = session_id.clone();
        let reader_app = app_handle.clone();
        let reader_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    data = output_rx.recv() => {
                        match data {
                            Some(data) => {
                                let payload = SshOutputPayload {
                                    session_id: reader_session_id.clone(),
                                    data,
                                };
                                let _ = reader_app.emit("ssh:output", &payload);
                            }
                            None => {
                                let payload = SshStatusPayload {
                                    session_id: reader_session_id.clone(),
                                    status: ConnectionStatus::Disconnected,
                                };
                                let _ = reader_app.emit("ssh:status", &payload);
                                break;
                            }
                        }
                    }
                    cmd = cmd_rx.recv() => {
                        match cmd {
                            Some(SessionCmd::Data(data)) => {
                                let _ = writer.write_all(&data);
                            }
                            Some(SessionCmd::Resize { cols, rows }) => {
                                let _ = master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                            }
                            Some(SessionCmd::Eof) | None => {
                                break;
                            }
                        }
                    }
                }
            }
        });

        // 8. Poll the child process exit status every 500ms. When the child
        // exits, signal disconnection. (The reader thread also emits
        // Disconnected on EOF — this is a belt-and-suspenders fallback.)
        let child_poll = child.clone();
        let poll_id = session_id.clone();
        let poll_app = app_handle.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if let Ok(mut c) = child_poll.lock() {
                if c.try_wait().map(|s| s.is_some()).unwrap_or(true) {
                    let _ = poll_app.emit(
                        "ssh:status",
                        &SshStatusPayload {
                            session_id: poll_id.clone(),
                            status: ConnectionStatus::Disconnected,
                        },
                    );
                    break;
                }
            } else {
                break;
            }
        });

        // 9. Emit Connected status
        let _ = app_handle.emit(
            "ssh:status",
            &SshStatusPayload {
                session_id: session_id.clone(),
                status: ConnectionStatus::Connected,
            },
        );

        Ok(Self {
            cmd_tx,
            reader_task,
            child,
        })
    }

    pub fn send_input(&self, data: &[u8]) -> Result<(), SshError> {
        self.cmd_tx
            .send(SessionCmd::Data(data.to_vec()))
            .map_err(|_| SshError::ChannelError("local session task closed".to_string()))
    }

    pub fn resize_pty(&self, cols: u16, rows: u16) -> Result<(), SshError> {
        self.cmd_tx
            .send(SessionCmd::Resize { cols, rows })
            .map_err(|_| SshError::ChannelError("local session task closed".to_string()))
    }

    pub async fn disconnect(self) -> Result<(), SshError> {
        let _ = self.cmd_tx.send(SessionCmd::Eof);
        // Kill the child process to ensure the PTY closes
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
        let _ = self.reader_task.await;
        Ok(())
    }
}
