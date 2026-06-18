#!/bin/bash
# Install Nerd Fonts for terminal setup
# Downloads FiraCode Nerd Font (primary iTerm2 font) and Meslo Nerd Font (p10k recommended)
set -e

FONT_DIR="$HOME/Library/Fonts/NerdFonts"
mkdir -p "$FONT_DIR"

# Latest Nerd Fonts release
NERD_FONTS_VERSION="v3.3.0"
BASE_URL="https://github.com/ryanoasis/nerd-fonts/releases/download/${NERD_FONTS_VERSION}"

echo "==> Downloading Nerd Fonts..."

# FiraCode Nerd Font (used at 19pt in iTerm2: "FiraCodeNF-Reg")
curl -fSL "$BASE_URL/FiraCode.zip" -o /tmp/FiraCode.zip
unzip -o /tmp/FiraCode.zip -d "$FONT_DIR" "*.ttf"
rm /tmp/FiraCode.zip
echo "  ✓ FiraCode Nerd Font installed"

# Meslo Nerd Font (Powerlevel10k recommended)
curl -fSL "$BASE_URL/Meslo.zip" -o /tmp/Meslo.zip
unzip -o /tmp/Meslo.zip -d "$FONT_DIR" "*.ttf"
rm /tmp/Meslo.zip
echo "  ✓ Meslo Nerd Font installed"

# JetBrainsMono Nerd Font (optional, nice fallback)
curl -fSL "$BASE_URL/JetBrainsMono.zip" -o /tmp/JetBrainsMono.zip
unzip -o /tmp/JetBrainsMono.zip -d "$FONT_DIR" "*.ttf"
rm /tmp/JetBrainsMono.zip
echo "  ✓ JetBrainsMono Nerd Font installed"

echo "==> Done! Fonts installed to $FONT_DIR"
echo "    You may need to restart iTerm2 for fonts to appear."
