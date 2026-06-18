#!/bin/bash
# =============================================================================
# Terminal Setup — replicates yuyuyu's macOS terminal environment
# Run: bash setup.sh
# =============================================================================
set -e

DOTFILES="$(cd "$(dirname "$0")" && pwd)"
echo "==> Setting up from: $DOTFILES"
echo ""

# ---- Step 1: Xcode CLI tools ----
echo "==> [1/7] Checking Xcode CLI tools..."
if ! xcode-select -p &>/dev/null; then
    echo "    Installing Xcode CLI tools..."
    xcode-select --install
    echo "    ⚠️  After installation completes, re-run this script."
    exit 0
fi
echo "    ✓ Xcode CLI tools ready"

# ---- Step 2: Homebrew ----
echo "==> [2/7] Checking Homebrew..."
if ! command -v brew &>/dev/null; then
    echo "    Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Apple Silicon
    if [[ -f /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
    # Intel
    if [[ -f /usr/local/Homebrew/bin/brew ]]; then
        eval "$(/usr/local/Homebrew/bin/brew shellenv)"
    fi
fi
echo "    ✓ Homebrew ready"

# ---- Step 3: Brew bundle ----
echo "==> [3/7] Installing brew packages..."
brew bundle --file="$DOTFILES/brew/Brewfile" --no-lock
echo "    ✓ Packages installed"

# ---- Step 4: Fonts ----
echo "==> [4/7] Installing Nerd Fonts..."
bash "$DOTFILES/fonts/install.sh"

# ---- Step 5: Oh My Zsh ----
echo "==> [5/7] Setting up Oh My Zsh..."
if [[ ! -d "$HOME/.oh-my-zsh" ]]; then
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
fi

# OMZ custom plugins
ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
if [[ ! -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ]]; then
    git clone https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
fi
if [[ ! -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ]]; then
    git clone https://github.com/zsh-users/zsh-syntax-highlighting "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"
fi

# Powerlevel10k
if [[ ! -d "$ZSH_CUSTOM/themes/powerlevel10k" ]]; then
    git clone --depth=1 https://github.com/romkatv/powerlevel10k.git "$ZSH_CUSTOM/themes/powerlevel10k"
fi
echo "    ✓ Oh My Zsh + plugins + p10k ready"

# ---- Step 6: Config files ----
echo "==> [6/7] Installing config files..."
cp "$DOTFILES/configs/zshrc" "$HOME/.zshrc"
cp "$DOTFILES/configs/p10k.zsh" "$HOME/.p10k.zsh"
cp "$DOTFILES/configs/zshenv" "$HOME/.zshenv"
cp "$DOTFILES/configs/zprofile" "$HOME/.zprofile"

# Git config (only if not already set)
if [[ ! -f "$HOME/.gitconfig" ]]; then
    cp "$DOTFILES/configs/gitconfig" "$HOME/.gitconfig"
    echo "    ⚠️  Edit ~/.gitconfig to set your name & email"
fi

# Cargo mirror (for users in China)
mkdir -p "$HOME/.cargo"
cp "$DOTFILES/configs/cargo-config.toml" "$HOME/.cargo/config.toml"
echo "    ✓ Config files installed"

# ---- Step 7: Rust ----
echo "==> [7/7] Checking Rust..."
if ! command -v rustup &>/dev/null; then
    echo "    Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi
echo "    ✓ Rust ready"

# ---- Done ----
echo ""
echo "============================================================================="
echo "✅ Setup complete!"
echo ""
echo "Manual steps remaining:"
echo "  1. Restart iTerm2"
echo "  2. iTerm2 → Preferences → Colors → Import 'iterm/catppuccin-frappe.itermcolors'"
echo "  3. iTerm2 → Preferences → Profiles → Text → Font → 'FiraCode Nerd Font' 19pt"
echo "  4. iTerm2 → Preferences → Profiles → Window → 200 cols × 50 rows"
echo "  5. Edit ~/.zshrc — set SENTRY_AUTH_TOKEN, check JAVA_HOME/MAVEN_HOME paths"
echo "  6. Install Anaconda if needed: https://www.anaconda.com/download"
echo "  7. Run 'p10k configure' if you want to customize the prompt"
echo ""
echo "Then: source ~/.zshrc"
echo "============================================================================="
