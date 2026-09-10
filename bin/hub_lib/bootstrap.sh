#!/usr/bin/env bash

set -euo pipefail

if [[ -n "${HUB_LIB_BOOTSTRAP_SH:-}" ]]; then
  return 0
fi
HUB_LIB_BOOTSTRAP_SH=1

SCRIPT_DIR="$REPO_ROOT/bin"
HUB_PYTHONPATH="${REPO_ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
for _cmd in python3 tmux; do
  if ! command -v "$_cmd" >/dev/null 2>&1; then
    echo "agent-index: $_cmd is required on PATH. Install it, then re-run this command." >&2
    exit 1
  fi
done

# shellcheck source=/dev/null
source "$REPO_ROOT/bin/lib/tmux_session.sh"
TMUX_SOCKET_NAME="$(resolve_tmux_socket_name)"

usage() {
  cat <<'EOF'
Usage: agent-index

Start Hub.
EOF
}
