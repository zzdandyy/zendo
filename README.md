<p align="center">
  <img src="https://raw.githubusercontent.com/zzdandyy/zendo/main/src-tauri/icons/128x128.png" alt="Zendo" width="96" />
</p>

<h1 align="center">Zendo</h1>

<p align="center">
  <strong>SSH · SFTP · S3</strong> — all-in-one desktop client.
  <br/>
  Built with Tauri v2 for macOS, Windows & Linux.
</p>

<p align="center">
  <a href="https://github.com/zzdandyy/zendo/actions/workflows/ci.yml"><img src="https://github.com/zzdandyy/zendo/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/zzdandyy/zendo/releases"><img src="https://img.shields.io/github/v/release/zzdandyy/zendo?include_prereleases&label=latest" alt="Release" /></a>
</p>

---

## ✨ Features

<table>
  <tr>
    <td width="50%">
      <h3>🖥️ SSH Terminal</h3>
      <ul>
        <li>xterm.js + WebGL rendering</li>
        <li>Split panes (horizontal / vertical), tabs, floating windows</li>
        <li>Per-pane accent colours (OKLCH), cursor colour follows accent</li>
        <li>Pin tabs — restore full layouts (splits + floating panes) on startup</li>
        <li>In-terminal regex search, select-to-copy, middle/right-click paste</li>
        <li>Keep-alive, startup commands, ProxyJump / bastion chains</li>
        <li>SSH key auth with auto PPK → OpenSSH conversion</li>
        <li>Import from <code>~/.ssh/config</code></li>
        <li>Local terminal (<code>portable_pty</code>, defaults to ~)</li>
      </ul>
    </td>
    <td width="50%">
      <h3>📁 Dual-Pane File Manager</h3>
      <ul>
        <li>Left & right panes — each independent: Local, SSH Host, or S3</li>
        <li>Cross-pane copy/paste = streaming relay transfer (64 KB chunks, zero local disk)</li>
        <li>Drag-and-drop upload with real-time progress (speed, ETA) via transfer queue</li>
        <li>Folder upload support — directory tree walk with concurrency control</li>
        <li>Hidden-file toggle, unified date format (<code>YYYY/MM/DD HH:mm</code>)</li>
        <li>Source selector in toolbar; create file/folder via right-click context menu</li>
        <li>Transfer popover & FAB, auto-refresh on upload completion</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td>
      <h3>📂 SFTP File Operations</h3>
      <ul>
        <li>Browse, upload, download, rename, move, copy, delete</li>
        <li>Drag-and-drop upload, Ctrl/Shift multi-select</li>
        <li>VS Code / external editor — save auto-uploads back</li>
        <li>Transfer queue with concurrency control, live speed & ETA</li>
        <li>Permission editor (chmod, recursive)</li>
        <li>sudo SFTP for protected directories</li>
      </ul>
    </td>
    <td>
      <h3>☁️ S3 Cloud Storage</h3>
      <ul>
        <li>Amazon S3, MinIO, Cloudflare R2, Backblaze B2 & compatibles</li>
        <li>Same file-browser UI as SFTP</li>
        <li>Presigned URL generation</li>
        <li>External editor for remote objects</li>
        <li>Multi-bucket switching</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td>
      <h3>🔌 Connection Management</h3>
      <ul>
        <li>Saved SSH hosts & S3 connections with labels, colors, groups</li>
        <li>Credentials in OS keychain (macOS Keychain / Windows DPAPI / Linux keyutils)</li>
        <li>Drag-and-drop reorder hosts & groups</li>
        <li>Health checks (DNS / port / SSH reachability)</li>
        <li>Encrypted backup/restore (Argon2id + AES-256-GCM)</li>
        <li>English & Chinese UI (react-i18next, ICU format)</li>
      </ul>
    </td>
    <td>
      <h3>🔀 SSH Port Forwarding</h3>
      <ul>
        <li>Local & remote tunnels, independent SSH connections</li>
        <li>Presets for common services (PostgreSQL, MySQL, Redis, MongoDB, HTTP, K8s)</li>
      </ul>
    </td>
  </tr>
</table>

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+
- **pnpm** — `corepack enable pnpm`
- **Rust** (latest stable)
- **Tauri system deps** → [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Install & Run

```bash
git clone https://github.com/zzdandyy/zendo.git
cd zendo

pnpm install
pnpm tauri dev       # Development
pnpm tauri build     # Production build
```

<details>
<summary>🇨🇳 Cargo mirror (for users in China)</summary>

```bash
mkdir -p ~/.cargo
cat > ~/.cargo/config.toml << 'EOF'
[source.crates-io]
replace-with = 'tuna'

[source.tuna]
registry = "sparse+https://mirrors.tuna.tsinghua.edu.cn/crates.io-index/"
EOF
```
</details>

## 🧱 Stack

| Layer | Tech |
|:------|:-----|
| Runtime | [Tauri v2](https://v2.tauri.app/) |
| Backend | Rust (tokio, russh, russh-sftp, rust-s3, rusqlite) |
| Frontend | React 19, TypeScript, Tailwind CSS v4 |
| Terminal | xterm.js (WebGL) |
| i18n | react-i18next (en / zh), type-safe keys |
| State | Zustand |
| Credentials | OS keychain (`keyring` crate) |
| Database | SQLite (bundled) |

## 📐 Architecture

```
src/                        # React frontend
  components/
    terminal/               # SSH terminal, splits, search, floating panes
    explorer/               # Shared file table, toolbar, breadcrumbs
    transfer/               # Dual-pane file manager (TransferPage, Pane, CrossTransferBar)
    sftp/ / s3/             # SFTP / S3 browsers (entry by dual-pane)
    dashboard/              # Host cards, groups
    layout/                 # AppShell, HomePanel, UnifiedTabBar
    transfers/              # Transfer progress popover
  i18n/                     # en / zh, common / hosts / settings namespaces
  stores/                   # Zustand stores (23)
  providers/                # SFTP, S3, Local filesystem adapters

src-tauri/src/              # Rust backend
  ssh/                      # SSH connections, PTY
  sftp/ / s3/               # SFTP / S3 sessions
  local/                    # Local terminal & filesystem commands
  transfer/                 # Cross-pane relay transfer (cross_transfer)
  db/                       # SQLite persistence
  vault/                    # OS keychain
  portforward/              # SSH tunnels
  backup/                   # Encrypted backup/restore
```

## 🧪 Testing

```bash
pnpm test          # Vitest (frontend)
cargo test         # Rust unit tests
make e2e           # E2E suite (requires Docker)
```

## 📄 License

[MIT](LICENSE)
