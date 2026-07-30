#!/usr/bin/env bash
set -euo pipefail

install_dir="${TENZAI_ORB_INSTALL_DIR:-$HOME/.local/bin}"
curl -fsSL https://raw.githubusercontent.com/TenzaiLabs/tenzai-cli/main/install.sh |
    TENZAI_INSTALL_DIR="$install_dir" sh

export PATH="$install_dir:$PATH"
if [[ -n "${BASH_ENV:-}" ]]; then
    printf 'export PATH="%s:%s"\n' "$install_dir" "\$PATH" >> "$BASH_ENV"
fi

tenzai --version
