# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## First-time setup（首次克隆后的环境搭建）

**Prerequisites**: Node.js, Xcode CLI tools (`xcode-select --install`), Docker (for E2E / test SSH servers).

### 1. Rust toolchain

```bash
# 安装 Rust（国内用户先配清华源）
export RUSTUP_DIST_SERVER=https://mirrors.tuna.tsinghua.edu.cn/rustup
export RUSTUP_UPDATE_ROOT=https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# 加载 Rust 环境变量（当前终端立即可用）
source ~/.cargo/env

# 设默认 toolchain
rustup default stable
```

### 2. Cargo 镜像（国内必须）

```bash
mkdir -p ~/.cargo
cat > ~/.cargo/config.toml << 'EOF'
[source.crates-io]
replace-with = 'tuna'

[source.tuna]
registry = "sparse+https://mirrors.tuna.tsinghua.edu.cn/crates.io-index/"
EOF
```

### 3. pnpm

```bash
corepack enable pnpm   # Node.js 自带，一行即可
```

### 4. 安装依赖 + 启动

```bash
pnpm install            # 前端依赖
source ~/.cargo/env     # 确保 cargo 在 PATH 中（如果开了新终端）
pnpm tauri dev          # 启动！首次会编译 Rust 后端，需要几分钟
```

> **常见坑**：`~/.profile` 属主是 root 会导致 rustup 写入失败。不影响使用，手动加 `source "$HOME/.cargo/env"` 到 `~/.zshrc` 即可。
>
> **pnpm 版本**：`package.json` 锁定了 `pnpm@10.34.3`，corepack 会自动匹配。如果 Node.js < 22.13，需手动 `corepack use pnpm@latest-10`。

## Commands

```bash
# Development
pnpm dev                 # Vite dev server at localhost:1420 (for `tauri dev`)
pnpm tauri dev           # Full Tauri dev mode (Vite + Rust backend)

# Build & preview
pnpm build               # TypeScript compile + Vite production bundle
pnpm tauri build         # Full Tauri release build (native binary)
pnpm preview             # Vite preview server

# Testing
pnpm test                # Run Vitest (src/**/*.{test,spec}.{ts,tsx})
pnpm test -- -t "name"   # Run a single Vitest test by name
pnpm test -- path/to/file # Run a single Vitest file

make e2e                 # Full E2E suite (Docker, real SSH servers)
make e2e-shell            # Interactive shell in the E2E runner container
E2E_FORCE_BUILD=1 make e2e  # Force rebuild the debug binary before running
make e2e-clean            # Wipe E2E image + cached build volumes

# Dev SSH test servers (Docker — see Makefile for full list)
make start-ssh-pass       # SSH server on :2222 (testuser / testpass)
make start-ssh-key        # SSH server on :2223 (testuser + ed25519 key)
make ssh-clean            # Remove all test containers
```

## Release（发布新版本）

CI（`.github/workflows/release.yml`）只在推送 **`v*` tag** 时触发，平时 push 不进这个流程。

App 启动时会自动检查更新，对比 GitHub Releases 上的 `latest.json` 与本地版本的 semver。设置里的 "Check" 按钮同。

### 什么时候 release

功能攒够了，准备给用户发版时——不是每次 push。版本号只在这时改。

### 发布步骤

```bash
# 1. 改 tauri.conf.json 的 version
"version": "0.1.0"   # 从 0.0.0-dev → 正式版本

# 2. 提交 + 打 tag
git add -A && git commit -m "release v0.1.0"
git tag v0.1.0
git push origin main --follow-tags

# 3. CI 自动构建 macOS/Windows/Linux 二进制 → 创建 Release → 上传 latest.json
```

所有装了旧版本的用户下次启动就会收到更新通知。

### 手动上传（CI 挂掉时）
```bash
pnpm tauri build
# 产物在 src-tauri/target/release/bundle/
# 打开 github.com/zzdandyy/zendo/releases → Create a new release
# tag 填 v0.1.0，拖入 bundle 下的文件
```

## Git remotes

Zendo 是一个独立项目。`upstream` 仅用于跟踪原 [anySCP](https://github.com/macnev2013/anySCP) 的更新，按需 cherry-pick 有用的 commit。

```
origin   → https://github.com/zzdandyy/zendo.git    (push here)
upstream → https://github.com/macnev2013/anySCP.git  (pull only, reference)
```

> **注意：** 本项目 git 历史已独立于 upstream，不存在 merge-base，不能直接 `git merge upstream/main`。同步通过脚本 + cherry-pick 完成。

### 同步上游

```bash
# 查看上游新增了什么（推荐）
./scripts/sync-upstream.sh

# 查看完整 diff
./scripts/sync-upstream.sh --diff

# 审查通过后，更新已跟踪标记
./scripts/sync-upstream.sh --mark
```

脚本会记录上次审查到的 commit（`.git/upstream-last-seen`），每次只显示新增部分。审查后选择有用的 cherry-pick：

```bash
# 合并单个 commit
git cherry-pick <commit-hash>

# 如果有冲突，解决后
git cherry-pick --continue
```

**工作流：**

1. 定期跑 `./scripts/sync-upstream.sh` 看看原项目有没有有价值的新功能/修复
2. 用 `./scripts/sync-upstream.sh --diff` 看具体改动
3. 对有用的 cherry-pick，没用的跳过
4. 执行 `./scripts/sync-upstream.sh --mark` 更新标记，下次只看新的

## Architecture

### Stack
**Tauri v2** desktop app — Rust backend (tokio async runtime) + React 19 / TypeScript frontend. Package manager is **pnpm** (lockfile: `pnpm-lock.yaml`).

### Frontend ↔ Backend communication

Two channels:

1. **Command invoke** — Frontend calls `import("@tauri-apps/api/core").invoke("command_name", { args })`. All registered in `src-tauri/src/lib.rs` `generate_handler![]`. Commands are scoped by domain prefix: `ssh_*`, `sftp_*`, `scp_*`, `s3_*`, `pf_*` (port forwarding), `db:*` hosts/groups/settings/backup.

2. **Tauri events** — Backend pushes streaming data to the frontend via `app_handle.emit("channel", payload)`. Key channels:
   - `ssh:output` → raw PTY bytes (Uint8Array) per session
   - `ssh:status` → connection state changes
   - `pf:status` → tunnel up/down notifications
   - `{sftp,scp,s3}:transfer` → file transfer progress

Frontend hooks listen for these: `useSshOutput` (per session), `useSshStatus` (global), `usePortForwardEvents` (global), `useSftpTransfers` (global).

### State management (Zustand stores)

23 stores under `src/stores/`, each scoped to one domain. Key ones:

- **`tab-store`** — Unified tab bar. Tabs are typed: `terminal | sftp | s3 | transfer`. No page tabs — Connections, Transfers (dual-pane), and Settings live inside the **Home panel** (shown when `activeTabId === null`). The fixed Home button at the left of the tab bar toggles between the Home panel and terminal tabs. Right-click a tab for Rename / Duplicate. Tab order and active tab are tracked here; syncing with domain stores happens in `syncDomainStores()`.
- **`session-store`** — SSH terminal sessions and their layout tree. A `LayoutNode` is a binary tree where leaf nodes are panes (one session per pane) and internal nodes are splits (horizontal/vertical with a 0–1 ratio). Supports split/unsplit/zoom/float operations. Each tab owns one layout tree. `floatingPanes` (Map<tabId, FloatingPaneInfo[]>) tracks panes popped out as standalone floating windows. Methods: `splitPane`, `unsplitPane`, `floatPane`, `removeFloatingPane`, `renameSession`.
- **`terminal-instances`** — Module-level registry of xterm.js `Terminal` objects keyed by `sessionId`. The instance survives React remounts (e.g., during layout changes) so scrollback isn't lost. Owns the host DOM element; `Terminal.tsx` only attaches it.
- **`terminal-registry`** — Module-level registry of xterm SearchAddon instances, consumed by TerminalSearchBar.
- **`hosts-store`**, **`groups-store`**, **`s3-store`**, **`sftp-store`**, **`port-forward-store`**, **`settings-store`**, **`updater-store`**, **`transfer-store`**, **`toast-store`**, **`ui-store`**, **`health-store`**

### Explorer abstraction

`src/lib/explorer-transport.ts` abstracts over SFTP and SCP. Both expose an identical command surface (same operation names, argument shapes, return types), differing only in the Tauri command prefix (`sftp_` vs `scp_`) and session-id key. `explorerInvoke(transport, op, sessionId, extra)` dispatches transparently. SCP is used as a fallback when the remote has the SFTP subsystem disabled.

File system providers (`src/providers/sftp-provider.ts`, `src/providers/s3-provider.ts`, `src/providers/local-provider.ts`) adapt domain types to the generic `ExplorerEntry` / `FileSystemProvider` types used by the shared explorer UI components. Local provider wraps Tauri `local_*` commands.

### Backend (Rust)

`src-tauri/src/lib.rs` is the entry point. During `setup()`, managers are created as `Arc<T>` and injected via `app.manage()`:

| Manager | Purpose |
|---------|---------|
| `SshManager` | SSH sessions (russh), PTY, keep-alive |
| `SftpManager` | SFTP sessions (russh-sftp) |
| `ScpManager` | SCP sessions (legacy wire protocol, fallback) |
| `S3Manager` | S3-compatible storage (rust-s3) |
| `PortForwardManager` | SSH tunnel lifecycle |
| `TransferManager` / `ScpTransferManager` / `S3TransferManager` | Queue-based file transfers with concurrency control |
| `HostDb` | SQLite persistence (rusqlite, bundled) |

Credentials are stored in the OS keychain via the `keyring` crate (macOS Keychain, Windows DPAPI, Linux keyutils). The vault module (`src-tauri/src/vault/mod.rs`) provides `vault_save_credential`, `vault_delete_credential`, `vault_has_credential`.

Import/export: SSH `~/.ssh/config` parsing via `ssh2-config` crate. Encrypted backup/restore via Argon2id + AES-256-GCM.

### Navigation

No sidebar rail. A **Home button** (⌂) is fixed at the left of the tab bar:

- **Home** (`activeTabId === null`) → `HomePanel` renders with a nav rail: Connections, Transfers (dual-pane file manager), Settings. These switch content via `homeActivePage` in `ui-store`.
- **Terminal / SFTP / S3 tabs** → full-screen, no Home panel visible.

### Dual-pane file manager

`src/components/transfer/TransferPage.tsx` is a dual-pane file browser (like ForkLift/Total Commander):

- **Left & right panes** — each independently selectable: Local, SSH Host, or S3
- **Pane header removed** — source selection is in the toolbar via `ToolbarSourceButton` (replaces the old Home breadcrumb button)
- **Cross-pane transfer** — clipboard paste across panes calls `cross_transfer` (Rust streaming relay, no local disk)
- **Splitter** — static 50/50, not draggable; gutter has no grip icon
- **Hidden files toggle** — eye icon button in the toolbar row
- **Right pane empty state** — shows "Connect…" toolbar button + "Not connected" hint; sources picked via dropdown
- **Transfer FAB** — floating button at bottom-right of TransferPage, only visible when transfers > 0, opens TransferPopover
- **Source persistence** — left/right pane sources survive Home panel navigation via `ui-store.transferLeftSource` / `transferRightSource`
- **Host "File Browse"** — sets `pendingTransferRight` and switches to transfer page (not a tab)
- **Local file system** — full access, no sandbox; `rootLabel()` returns `"/"` not `"Local"`
- **Date format** — unified `YYYY/MM/DD HH:mm` (zero-padded, independent of locale)
- **Icons** — Local: `Monitor`, Host: `HardDrive`, S3: `Cloud` (consistent across terminal and transfer dropdowns)

### i18n

`src/i18n/` — react-i18next with ICU format, English (default) and Chinese. Three namespaces:

| Namespace | Scope |
|-----------|-------|
| `common` | Shared: buttons, status labels, nav labels, tab bar |
| `hosts` | Connections page: server cards, dialogs, tunnels, S3 |
| `settings` | Settings page |

Custom language detector reads from Zustand `settings-store.lang` (persisted to SQLite as `app_lang`). Lazy init via `initI18n()` called from `App`'s `useEffect`; `App` returns `null` until initialized. English JSON files define the key shape, `src/i18n/types.ts` derives a `DotKey<T>` type for type-safe `t()` calls.

**i18n is mandatory for all new UI text.** Every visible string — labels, buttons, placeholders, tooltips, aria-labels, error messages, confirm dialogs, toast messages — must use `t('namespace:key')`. No hardcoded English. When you spot a hardcoded string in existing code, fix it immediately; don't leave it behind.

Key pattern: `namespace:section.subsection.key` (e.g. `hosts:server.card.ping`, `hosts:hostdialog.label`).

**Adding translatable text:**

1. Add the English key to `src/i18n/locales/en/<namespace>.json` first — English files define the key shape for TypeScript type inference.
2. Add the Chinese translation to `src/i18n/locales/zh/<namespace>.json`.
3. In the component: `import { useTranslation } from "react-i18next"`, then `const { t } = useTranslation()`, then `t('namespace:key')`.
4. For ICU interpolation: `t('key', { var: value })` with `{var}` placeholders in the JSON values (e.g. `"panes": "{count} panes"`).

**Verification:** Run `npx tsc --noEmit` after changes — type-safe keys mean a typo in a key string is a compile error.

### Key patterns

- **Sudo SFTP**: When the user toggles the sudo toggle, the frontend calls `sftp_open` with `sudo: true` and replaces the tab ID (via `replaceTabId` in tab-store).
- **Tab bar ➕ button**: Right side of the tab bar has a `+` button with a popover listing Local Terminal, saved Hosts, and Cloud Storage connections. Click any to open a new tab. Hosts and S3 connections are lazy-loaded when the popover opens.
- **PaneHeader split popover**: A single split button opens a popover with direction toggle (horizontal/vertical) and options: Fork session, Local terminal, or pick a saved Host. The popover has viewport clamping to avoid off-screen overflow.
- **Floating panes**: A pane can be floated out of its split layout via the Float button (PictureInPicture2 icon, appears to the left of the split button when in a split). Floating panes are draggable (drag title bar) and resizable (bottom-right handle). They belong to a tab and are tracked in `session-store.floatingPanes`. Closing a float disconnects the session. Closing a tab cleans up all its floating panes.
- **Local terminal defaults to ~**: Local terminals use `dirs::home_dir()` as the working directory. The Rust side calls `cmd.cwd(home)` in `local/session.rs`.
- **Auto-rename to Workplace**: When a tab goes from single pane to split, `splitPane` auto-renames the tab label to "Workplace N" (increments across existing workplace tabs). Synced to both session-store and tab-store.
- **Duplicate copies full layout**: Right-click → Duplicate clones the entire layout tree (all panes + splits) and floating panes, not just the first session. Uses `remapLayout()` to deep-clone the tree with new session IDs.
- **`splitPane` copies `sessionType`**: When creating a new pane via split, `session-store.splitPane` copies the source session's `sessionType` if the new session doesn't already exist in the sessions map. This allows host splits (connect_saved_host) to provide their own hostConfig and label.
- **Dual-pane cross transfer**: `cross_transfer` Tauri command streams file contents from source to destination via 64KB chunks, no local disk. Validates local paths with `validate_local_path` (absolute, no `..`).
- **Pane source identity**: Pane auto-refreshes when source identity changes — tracked via `sourceId` memo (`local`, `host:<hostId>`, `s3:<connectionId>`).
- **Scrollbar hidden**: `.no-scrollbar` utility class hides scrollbar via `scrollbar-width: none` (Firefox) and `::-webkit-scrollbar { display: none }` (WebKit), applied to file table containers.
- **Zustand selector gotcha**: `Array.from(map.values())` in a Zustand selector creates a new array each evaluation → infinite loop. Fix: select the Map first, then convert to array with `useMemo`.
- **Startup theme injection**: Theme, accent, and font are resolved from SQLite in `setup()` and injected via `initialization_script` so there's no flash of wrong theme on first paint.
- **E2E terminal access**: `Terminal.tsx` registers xterm instances on `window.__e2eTerminals` so test helpers can read/write without poking canvas pixels.
- **E2E isolation**: Each test calls `resetApp()` which deletes `$XDG_DATA_HOME/com.macnev2013.anyscp` and calls `browser.reloadSession()`, giving each test a fresh SQLite DB.
- **E2E data-testid convention**: `<component>-<element>` (e.g., `host-modal-password`, `data-entry-name`).

### CSS / Theming

Tailwind CSS v4 with a custom theme system. Theme tokens are in `src/theme.css` (OKLCH-based). Accent color can be hue-based (via `--accent-hue` CSS custom property) or fully custom (via `--color-accent` as an explicit OKLCH value). Both light and dark themes are supported, selected in settings.

### Testing

**Tests are mandatory for all new features and bug fixes.** When you add or change code, add or update the corresponding tests. Never ship untested code.

#### Three tiers — pick the right one

| Tier | Scope | Location | Run |
|------|-------|----------|-----|
| **Vitest** | Pure logic, store methods, component behavior | `src/**/*.test.{ts,tsx}` (colocated) | `pnpm test` |
| **Rust `#[test]`** | Backend logic, parsing, encryption, DB ops | Same file as the code (`#[cfg(test)] mod tests` or inline `#[test]`) | `cargo test` |
| **E2E** | Complete user flows through the real app | `tests/e2e/specs/NN-name.spec.ts` | `make e2e` |

#### When to use each

**Vitest** — cheapest, fastest. Use for:
- New Zustand store methods (e.g. `renameSession`, `splitPane` edge cases)
- Pure utility functions (parsing, validation, transforms)
- Component interaction logic (dialog opens/closes, form validation, button states)
- Uses Testing Library + `@testing-library/jest-dom/vitest` in jsdom

**Rust `#[test]`** — backend correctness. Use for:
- New Tauri commands or manager methods
- Parsers, serializers, crypto, wire-protocol logic
- DB operations (use temp dirs, see `test_db()` in `db/mod.rs`)
- See existing patterns: `scp/listing.rs` (29 tests), `backup/mod.rs` (14), `ssh/keys.rs` (13), `editors/mod.rs` (10), `vault/mod.rs` (9)

**E2E** — full user journey through the real app. Use for:
- New Tauri commands that change UI state (connect, disconnect, file transfer)
- New UI flows (dialog → action → result)
- Regression tests for fixed bugs
- Specs run in lexical order against real SSH servers (linuxserver/openssh-server in Docker). Naming: `NN-brief-name.spec.ts`. Use `data-testid` convention: `<component>-<element>` (e.g. `host-modal-password`). Each test gets a fresh DB via `resetApp()`.

#### Verification before push

```bash
pnpm test --run                    # All 15 files, 92 tests — must pass
cargo test                         # All Rust tests — must pass (180+)
npx tsc --noEmit                   # Zero type errors
```

#### Coverage of existing test files

**Vitest (15 files, 92 tests):**
- Stores: `hosts-store`, `groups-store`, `settings-store`, `s3-store`
- Lib: `file-types`, `drop-conflicts`, `permissions`, `explorer-transport`
- Components: `DropOverwriteDialog`, `ExplorerView.upload`, `Terminal.clipboard`, `ExplorerFileTable.doubleclick`, `FilePropertiesDialog`
- Providers: `local-provider`

**Rust (14 modules with tests):**
`backup/mod.rs`(14), `db/mod.rs`(28), `editors/mod.rs`(10), `import/commands.rs`(6), `scp/exec.rs`(5), `scp/listing.rs`(29), `scp/mod.rs`(6), `sftp/commands.rs`(5), `sftp/mod.rs`(5), `sftp/transfer_manager.rs`(3), `ssh/keys.rs`(13), `ssh/manager.rs`(4), `types/error.rs`(1), `vault/mod.rs`(9)

**E2E (62 specs):** 01-smoke through 64-s3-reorder — covers host CRUD, SSH connect (password/key), SFTP/SCP/S3 file operations, port forwarding, settings, import/export, proxyjump, sudo, backup/restore.
