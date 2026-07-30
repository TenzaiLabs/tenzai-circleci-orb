#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

fail() {
    echo "test failed: $*" >&2
    exit 1
}

mock_bin="$scratch/mock-bin"
mkdir -p "$mock_bin"
cat > "$mock_bin/curl" <<'SCRIPT'
#!/usr/bin/env bash
for argument in "$@"; do
    case "$argument" in
        http*) url="$argument" ;;
    esac
done
printf '%s\n' "$url" > "$TEST_CURL_CALLS"
cat "$TEST_INSTALLER_FIXTURE"
SCRIPT
chmod +x "$mock_bin/curl"

installer_fixture="$scratch/install-fixture.sh"
cat > "$installer_fixture" <<'SCRIPT'
#!/bin/sh
set -eu
: "${TENZAI_INSTALL_DIR:?}"
mkdir -p "$TENZAI_INSTALL_DIR"
cat > "$TENZAI_INSTALL_DIR/tenzai" <<'BINARY'
#!/usr/bin/env bash
echo "tenzai test version"
BINARY
chmod +x "$TENZAI_INSTALL_DIR/tenzai"
SCRIPT

install_dir="$scratch/install-bin"
bash_env="$scratch/bash_env"
curl_calls="$scratch/curl-calls"
PATH="$mock_bin:$PATH" \
    BASH_ENV="$bash_env" \
    TEST_CURL_CALLS="$curl_calls" \
    TEST_INSTALLER_FIXTURE="$installer_fixture" \
    TENZAI_ORB_INSTALL_DIR="$install_dir" \
    bash "$root/src/scripts/install.sh" >/dev/null

[[ -x "$install_dir/tenzai" ]] || fail "CLI was not installed"
grep -Fx "https://raw.githubusercontent.com/TenzaiLabs/tenzai-cli/main/install.sh" \
    "$curl_calls" >/dev/null || fail "unexpected installer URL"
grep -F "$install_dir" "$bash_env" >/dev/null || fail "install path was not persisted"

for from_commit in "" "<nil>"; do
    TENZAI_ORB_FROM_COMMIT="$from_commit" \
        bash "$root/src/scripts/trigger.sh" >/dev/null
done

calls="$scratch/tenzai-calls"
cat > "$mock_bin/tenzai" <<'SCRIPT'
#!/usr/bin/env bash
printf 'server=%s\n' "$TENZAI_SERVER" > "$TEST_TENZAI_CALLS"
printf 'token=%s\n' "$TENZAI_SERVICE_ACCOUNT_TOKEN" >> "$TEST_TENZAI_CALLS"
printf '%s\n' "$@" >> "$TEST_TENZAI_CALLS"
SCRIPT
chmod +x "$mock_bin/tenzai"

PATH="$mock_bin:$PATH" \
    TEST_TENZAI_CALLS="$calls" \
    TENZAI_SERVICE_ACCOUNT_TOKEN="service-token" \
    TENZAI_ORB_APP_ID="app-id" \
    TENZAI_ORB_SERVER="staging" \
    TENZAI_ORB_FROM_COMMIT="base-sha" \
    TENZAI_ORB_REPOSITORY="owner/repository" \
    TENZAI_ORB_TO_COMMIT="head-sha" \
    bash "$root/src/scripts/trigger.sh"

cat > "$scratch/expected-calls" <<'EOF'
server=staging
token=service-token
test
run
--app-id
app-id
--profile
commit-diff
--repository
owner/repository
--commit-from
base-sha
--commit-to
head-sha
EOF
diff -u "$scratch/expected-calls" "$calls"

echo "All script tests passed."
