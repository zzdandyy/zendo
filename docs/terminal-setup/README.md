# Terminal Setup — yuyuyu's macOS 终端环境复刻

全新 macOS 机器上，**一条命令** 复刻完整终端环境，或逐步手动安装。

---

## 快速开始（自动化）

```bash
cd ~/Desktop/terminal-setup
bash setup.sh
```

脚本会按顺序安装：Xcode CLI → Homebrew → 基础包 → Nerd Fonts → Oh My Zsh + 插件 + p10k → 配置文件 → Rust。

---

## 手动安装指南

### 1. Xcode Command Line Tools

```bash
xcode-select --install
```

### 2. Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

安装后确保 brew 在 PATH 里（Apple Silicon）：
```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

国内用户设中科大镜像（可选）：
```bash
echo 'export HOMEBREW_API_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles/api' >> ~/.zprofile
echo 'export HOMEBREW_BOTTLE_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles/bottles' >> ~/.zprofile
```

### 3. 基础工具

```bash
brew install zsh starship nvm pyenv git wget sshpass
```

### 4. 字体 — Nerd Fonts

```bash
bash fonts/install.sh
```

安装后会得到：

| 字体 | 用途 |
|------|------|
| **FiraCode Nerd Font** | iTerm2 主字体，19pt Regular |
| **MesloLGL Nerd Font** | Powerlevel10k 推荐字体 |
| JetBrainsMono Nerd Font | 备用 |

### 5. Oh My Zsh + 插件 + Powerlevel10k

```bash
# Oh My Zsh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

# 插件
ZSH_CUSTOM=${ZSH_CUSTOM:-~/.oh-my-zsh/custom}
git clone https://github.com/zsh-users/zsh-autosuggestions $ZSH_CUSTOM/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting $ZSH_CUSTOM/plugins/zsh-syntax-highlighting

# Powerlevel10k 主题
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git $ZSH_CUSTOM/themes/powerlevel10k
```

### 6. 配置文件

```bash
cp configs/zshrc     ~/.zshrc
cp configs/p10k.zsh  ~/.p10k.zsh
cp configs/zshenv    ~/.zshenv
cp configs/zprofile  ~/.zprofile
cp configs/gitconfig ~/.gitconfig          # ⚠️ 改 name/email

# Cargo 镜像（国内用户）
mkdir -p ~/.cargo
cp configs/cargo-config.toml ~/.cargo/config.toml
```

### 7. Rust

```bash
# 国内用户先配清华源
export RUSTUP_DIST_SERVER=https://mirrors.tuna.tsinghua.edu.cn/rustup
export RUSTUP_UPDATE_ROOT=https://mirrors.tuna.tsinghua.edu.cn/rustup

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env
rustup default stable
```

### 8. iTerm2 配置

1. 安装 [iTerm2](https://iterm2.com/)（或 `brew install --cask iterm2`）
2. **配色：** Preferences → Profiles → Colors → Color Presets → Import → 选择 `iterm/catppuccin-frappe.itermcolors` → 选中 Catppuccin Frappé
3. **字体：** Preferences → Profiles → Text → Font → `FiraCode Nerd Font` → Regular → 19pt
4. **窗口大小：** Preferences → Profiles → Window → Columns: 200, Rows: 50
5. **其他设定：**
   - Text → 取消勾选 "Use different font for non-ASCII"
   - Terminal → Scrollback Lines: 1000

### 9. 改 ~/.zshrc 里机器相关的东西

| 行 | 需要改的 | 说明 |
|----|----------|------|
| `export SENTRY_AUTH_TOKEN` | 你自己的 Sentry token | 没有用到就删掉这行 |
| `export JAVA_HOME` | 确认 JDK 路径 | 没有装 Java 就删掉 |
| `export MAVEN_HOME` | 指向 IntelliJ Maven 目录 | 没用 Maven 就删掉 |
| `export PATH=...php@7.4...` | PHP 路径 | 没有就删掉 |
| `export PATH=...arcanist...` | Phabricator Arcanist 路径 | 没有就删掉 |
| `gitconfig` 里 name/email | 改成你自己的 | 必须改 |

### 10. Python（可选）

```bash
# Anaconda（如果需要）
# 从 https://www.anaconda.com/download 下载安装，然后 conda init zsh

# 或者只用 pyenv
pyenv install 3.12
pyenv global 3.12
```

### 11. Node.js（可选）

```bash
nvm install 22
nvm alias default 22
```

### 12. 重新加载

```bash
source ~/.zshrc
```

首次加载 p10k 可能会提示运行 `p10k configure`——可以直接 `source ~/.p10k.zsh` 使用当前配置。

---

## 文件清单

```
terminal-setup/
├── README.md                          # 本文件
├── setup.sh                           # 一键安装脚本
├── configs/
│   ├── zshrc                          # Zsh 主配置（Oh My Zsh + 插件 + 工具链）
│   ├── p10k.zsh                       # Powerlevel10k lean 风格主题配置
│   ├── zshenv                         # 环境变量（加载 cargo env）
│   ├── zprofile                       # Homebrew / Python PATH
│   ├── gitconfig                      # Git 全局配置
│   └── cargo-config.toml              # Rust 清华镜像源
├── fonts/
│   └── install.sh                     # 下载并安装 FiraCode + Meslo + JetBrainsMono Nerd Fonts
├── iterm/
│   └── catppuccin-frappe.itermcolors  # Catppuccin Frappé 配色方案
└── brew/
    └── Brewfile                       # Homebrew 依赖清单
```

---

## 你当前环境的摘要

| 组件 | 当前配置 |
|------|----------|
| **系统** | macOS 13.5 (Intel x86_64) |
| **Shell** | Zsh 5.9 |
| **终端** | iTerm2 |
| **字体** | FiraCode Nerd Font 19pt Regular |
| **配色** | Catppuccin Frappé |
| **主题** | Powerlevel10k (lean, single-line, 24h, transient prompt) |
| **框架** | Oh My Zsh |
| **OMZ 插件** | git, zsh-autosuggestions, zsh-syntax-highlighting |
| **快捷键** | Ctrl+E → end-of-line |
| **Node** | NVM (default: 22) |
| **Python** | Pyenv + Anaconda3 |
| **Rust** | rustup stable |
| **Java** | Corretto 17 |
| **Homebrew 镜像** | USTC |
| **Cargo 镜像** | Tsinghua tuna |
