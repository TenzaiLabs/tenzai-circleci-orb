#!/usr/bin/env bash
set -euo pipefail

from_commit="${TENZAI_ORB_FROM_COMMIT:-}"
if [[ -z "$from_commit" || "$from_commit" == "<nil>" ]]; then
    echo "No previous pipeline revision; skipping Tenzai test."
    exit 0
fi

command -v tenzai >/dev/null 2>&1 || {
    echo "The Tenzai CLI must be installed and available on PATH." >&2
    exit 1
}

: "${TENZAI_ORB_APP_ID:?Tenzai application ID is required}"
: "${TENZAI_ORB_REPOSITORY:?Repository is required}"
: "${TENZAI_ORB_TO_COMMIT:?Target commit is required}"

export TENZAI_SERVER="${TENZAI_ORB_SERVER:-https://app.tenzai.io}"
exec tenzai test run \
    --app-id "$TENZAI_ORB_APP_ID" \
    --profile commit-diff \
    --repository "$TENZAI_ORB_REPOSITORY" \
    --commit-from "$from_commit" \
    --commit-to "$TENZAI_ORB_TO_COMMIT"
