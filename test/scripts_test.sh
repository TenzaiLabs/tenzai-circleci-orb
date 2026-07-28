#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

fail() {
    echo "test failed: $*" >&2
    exit 1
}

make_archive() {
    local target="$1"
    local archive="tenzai-0.2.0-$target.tar.gz"
    local stage="$scratch/stage/tenzai-0.2.0-$target"
    mkdir -p "$stage"
    cat > "$stage/tenzai" <<'SCRIPT'
#!/usr/bin/env bash
echo "tenzai 0.2.0"
SCRIPT
    chmod +x "$stage/tenzai"
    tar -czf "$scratch/$archive" -C "$scratch/stage" "tenzai-0.2.0-$target"
    (cd "$scratch" && sha256sum "$archive" > "$archive.sha256")
}

make_archive "x86_64-unknown-linux-gnu"
make_archive "aarch64-unknown-linux-gnu"

mock_bin="$scratch/mock-bin"
mkdir -p "$mock_bin"
cat > "$mock_bin/uname" <<'SCRIPT'
#!/usr/bin/env bash
case "${1:-}" in
    -s) echo "${TEST_UNAME_S:-Linux}" ;;
    -m) echo "${TEST_UNAME_M:-x86_64}" ;;
    *) exit 1 ;;
esac
SCRIPT
cat > "$mock_bin/curl" <<'SCRIPT'
#!/usr/bin/env bash
while (($#)); do
    case "$1" in
        --output)
            output="$2"
            shift 2
            ;;
        http*)
            url="$1"
            shift
            ;;
        *) shift ;;
    esac
done
cp "$TEST_RELEASE_FIXTURES/$(basename "$url")" "$output"
SCRIPT
chmod +x "$mock_bin/uname" "$mock_bin/curl"

for architecture in x86_64 aarch64; do
    case_dir="$scratch/install-$architecture"
    mkdir -p "$case_dir/home"
    bash_env="$case_dir/bash_env"
    PATH="$mock_bin:$PATH" \
        HOME="$case_dir/home" \
        BASH_ENV="$bash_env" \
        TEST_RELEASE_FIXTURES="$scratch" \
        TEST_UNAME_M="$architecture" \
        TENZAI_ORB_CLI_VERSION="0.2.0" \
        bash "$root/src/scripts/install.sh" >/dev/null

    installed="$case_dir/home/.local/bin/tenzai"
    [[ -x "$installed" ]] || fail "CLI was not installed for $architecture"
    "$installed" --version >/dev/null
    grep -F "$case_dir/home/.local/bin" "$bash_env" >/dev/null || \
        fail "install path was not persisted for $architecture"
done

bad_fixtures="$scratch/bad-fixtures"
mkdir -p "$bad_fixtures"
cp "$scratch/tenzai-0.2.0-x86_64-unknown-linux-gnu.tar.gz" "$bad_fixtures/"
printf '%064d  %s\n' 0 "tenzai-0.2.0-x86_64-unknown-linux-gnu.tar.gz" > \
    "$bad_fixtures/tenzai-0.2.0-x86_64-unknown-linux-gnu.tar.gz.sha256"
if PATH="$mock_bin:$PATH" \
    HOME="$scratch/bad-home" \
    TEST_RELEASE_FIXTURES="$bad_fixtures" \
    TENZAI_ORB_CLI_VERSION="0.2.0" \
    bash "$root/src/scripts/install.sh" >/dev/null 2>&1; then
    fail "installer accepted a checksum mismatch"
fi

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
