# Zendo

SSH、SFTP、S3 一体化桌面客户端。基于 Tauri v2（Rust + React），支持 macOS / Windows / Linux。

## 功能

### SSH 终端
- xterm.js + WebGL 渲染，支持分屏（横/竖）、标签页、浮窗
- 终端内搜索（正则），复制即选中、中键/右键粘贴
- Keep-alive、启动命令、代理跳板（bastion / ProxyJump chain）
- SSH 密钥认证，自动 PPK → OpenSSH 转换
- 从 `~/.ssh/config` 导入连接
- 本地终端（portable_pty，默认 ~）

### 双栏文件管理器
- 左右双栏，每栏独立选择来源：本地 / SSH 主机 / S3 云存储
- 跨栏复制粘贴 = 流式中转传输（Rust 后端，不落盘）
- 隐藏文件切换、统一日期格式（YYYY/MM/DD HH:mm）
- 工具栏内来源选择器，替换传统面包屑 Home 按钮
- 传输悬浮按钮（右下角，有传输任务时显示）

### SFTP 文件管理
- 浏览、上传、下载、重命名、移动、复制、删除
- 拖拽上传，Ctrl/Shift 多选批量操作
- VS Code / 外部编辑器打开远端文件，保存自动回传
- 传输队列，并发控制，实时速度和 ETA
- 文件权限编辑（chmod，含递归）
- sudo SFTP（需要 sudo 权限的目录也能操作）

### S3 云存储
- 支持 Amazon S3、MinIO、Cloudflare R2、Backblaze B2 等 S3 兼容服务
- 与 SFTP 共用同一套文件浏览器 UI
- 预签名 URL 生成，外部编辑器编辑远端对象
- 多 Bucket 切换

### 连接管理
- SSH 主机 & S3 连接保存，标签、颜色、分组
- 凭据存储在 OS 密钥链（macOS Keychain / Windows DPAPI / Linux keyutils）
- 拖拽排序主机和分组
- 主机健康检查（DNS / 端口 / SSH 可达性）
- 加密备份/恢复（Argon2id + AES-256-GCM）
- 中英文界面（react-i18next，ICU 格式）

### SSH 端口转发
- 本地 & 远程隧道，独立 SSH 连接
- 常用服务预设（PostgreSQL、MySQL、Redis、MongoDB、HTTP、K8s）

## 构建

### 环境要求
- Node.js 18+（<22.13 需要 pin pnpm 版本）
- pnpm — `corepack enable pnpm`
- Rust（latest stable）
- Tauri 系统依赖：[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Cargo 国内镜像（可选）

```bash
mkdir -p ~/.cargo
cat > ~/.cargo/config.toml << 'EOF'
[source.crates-io]
replace-with = 'tuna'

[source.tuna]
registry = "sparse+https://mirrors.tuna.tsinghua.edu.cn/crates.io-index/"
EOF
```

### 构建步骤

```bash
git clone https://github.com/zzdandyy/zendo.git
cd zendo

pnpm install
pnpm tauri dev      # 开发模式
pnpm tauri build    # 生产构建
```

## 技术栈

| 层 | 技术 |
|---|------|
| 运行时 | Tauri v2 |
| 后端 | Rust (tokio, russh, russh-sftp, rust-s3, rusqlite) |
| 前端 | React 19, TypeScript, Tailwind CSS v4 |
| 终端 | xterm.js (WebGL) |
| 国际化 | react-i18next (en/zh)，类型安全 key |
| 状态管理 | Zustand |
| 凭据存储 | OS keychain (`keyring` crate) |
| 数据库 | SQLite（内置） |

## 架构

```
src/                     # React 前端
  components/
    terminal/            # SSH 终端、分屏、搜索、浮窗
    explorer/            # 共用文件表格、工具栏、面包屑
    transfer/            # 双栏文件管理器（TransferPage、Pane、CrossTransferBar）
    sftp/ / s3/          # SFTP / S3 浏览器（已精简，入口由双栏接管）
    dashboard/           # 主机卡片、分组
    layout/              # AppShell、HomePanel、UnifiedTabBar
    transfers/           # 传输进度弹出
  i18n/                  # 国际化：en/zh，common/hosts/settings 命名空间
  stores/                # Zustand 状态（23 个 store）
  providers/             # SFTP、S3、Local 文件系统适配

src-tauri/src/           # Rust 后端
  ssh/                   # SSH 连接、PTY
  sftp/ / s3/            # SFTP / S3 会话
  local/                 # 本地终端 & 本地文件系统命令
  transfer/              # 跨栏中转传输（cross_transfer）
  db/                    # SQLite 持久化
  vault/                 # OS 密钥链
  portforward/           # SSH 隧道
  backup/                # 加密备份/恢复
```

## 测试

```bash
pnpm test          # Vitest（前端）
cargo test         # Rust 单测
make e2e           # E2E 全链路（需要 Docker）
```

## 许可

MIT License.
