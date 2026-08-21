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
# Not exported: this is agent-index's own lookup of a fixed, hardcoded
# path (backend_core.access.settings.agent_window_session_root() is
# `~/.agent-window/session`, unconditionally -- no repo, workspace, or
# session ever changes it), used only by the bash helpers below. Nothing
# else needs it, and nothing downstream (a spawned chat server, a tmux
# session) should ever see this name in its own environment.
AGENT_WINDOW_LOG_DIR="$HOME/.agent-window/session"

for _cmd in python3 tmux; do
  if ! command -v "$_cmd" >/dev/null 2>&1; then
    echo "agent-index: $_cmd is required on PATH. Install it, then re-run this command." >&2
    exit 1
  fi
done

_ALL_AGENTS="$(PYTHONPATH="$HUB_PYTHONPATH" python3 -c "from backend_core.agents.registry import ALL_AGENT_NAMES; print(' '.join(ALL_AGENT_NAMES))" 2>/dev/null || echo "claude codex gemini cursor")"
read -ra _ALL_AGENTS_ARR <<< "$_ALL_AGENTS"

default_tmux_socket_name() {
  printf '%s\n' "agent-window"
}

TMUX_SOCKET_NAME="${AGENT_WINDOW_TMUX_SOCKET:-$(default_tmux_socket_name)}"

tmux() {
  if [[ "$TMUX_SOCKET_NAME" == */* ]]; then
    command tmux -S "$TMUX_SOCKET_NAME" "$@"
  else
    command tmux -L "$TMUX_SOCKET_NAME" "$@"
  fi
}

usage() {
  cat <<'EOF'
Usage: agent-index [--session NAME] [--chat] [--hub] [--hub-port N] [--http|--https]

Start Hub or the chat server for the current or archived session.
EOF
}

realpath_or_echo() {
  python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null || printf '%s\n' "$1"
}
