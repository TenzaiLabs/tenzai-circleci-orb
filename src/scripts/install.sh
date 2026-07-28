#!/usr/bin/env bash
set -euo pipefail

version="${TENZAI_ORB_CLI_VERSION:?Tenzai CLI version is required}"
install_dir="${TENZAI_ORB_INSTALL_DIR:-$HOME/.local/bin}"

if [[ "$(uname -s)" != "Linux" ]]; then
    echo "The Tenzai orb installer supports Linux executors only." >&2
    exit 1
fi

case "$(uname -m)" in
    x86_64 | amd64) target="x86_64-unknown-linux-gnu" ;;
    aarch64 | arm64) target="aarch64-unknown-linux-gnu" ;;
    *)
        echo "Unsupported architecture: $(uname -m)" >&2
        exit 1
        ;;
esac

archive="tenzai-$version-$target.tar.gz"
release_url="https://github.com/TenzaiLabs/tenzai-cli/releases/download/tenzai-v$version"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

curl --fail --silent --show-error --location \
    --output "$scratch/$archive" "$release_url/$archive"
curl --fail --silent --show-error --location \
    --output "$scratch/$archive.sha256" "$release_url/$archive.sha256"

(cd "$scratch" && sha256sum --check "$archive.sha256")
tar -xzf "$scratch/$archive" -C "$scratch" "tenzai-$version-$target/tenzai"
mkdir -p "$install_dir"
install -m 0755 "$scratch/tenzai-$version-$target/tenzai" "$install_dir/tenzai"

export PATH="$install_dir:$PATH"
if [[ -n "${BASH_ENV:-}" ]]; then
    printf 'export PATH="%s:%s"\n' "$install_dir" "\$PATH" >> "$BASH_ENV"
fi

tenzai --version
