#!/usr/bin/env bash

set -euo pipefail

if [[ -n "${HUB_LIB_BOOTSTRAP_SH:-}" ]]; then
  return 0
fi
HUB_LIB_BOOTSTRAP_SH=1

SCRIPT_DIR="$REPO_ROOT/bin"
HUB_PYTHONPATH="${REPO_ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
AGENT_WINDOW_RUN_DIR="${AGENT_WINDOW_RUN_DIR:-$(PYTHONPATH="$HUB_PYTHONPATH" python3 - "$REPO_ROOT" <<'PYEOF'
import sys
from pathlib import Path

repo_root = Path(sys.argv[1]).resolve()
from backend_core.access.settings import agent_window_run_dir

print(agent_window_run_dir())
PYEOF
)}"
export AGENT_WINDOW_RUN_DIR
for _cmd in python3 tmux; do
  if ! command -v "$_cmd" >/dev/null 2>&1; then
    echo "agent-index: $_cmd is required on PATH. Install it, then re-run this command." >&2
    exit 1
  fi
done

# shellcheck source=/dev/null
source "$REPO_ROOT/bin/lib/tmux_session.sh"
TMUX_SOCKET_NAME="$(resolve_tmux_socket_name)"

tmux() {
  if [[ "$TMUX_SOCKET_NAME" == */* ]]; then
    command tmux -S "$TMUX_SOCKET_NAME" "$@"
  else
    command tmux -L "$TMUX_SOCKET_NAME" "$@"
  fi
}

usage() {
  cat <<'EOF'
Usage: agent-index [--hub-port N]

Start Hub.
EOF
}

realpath_or_echo() {
  python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null || printf '%s\n' "$1"
}
