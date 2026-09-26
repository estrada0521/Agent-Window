#!/usr/bin/env bash

if [[ -n "${AGENT_WINDOW_LIB_TMUX_SESSION_SH:-}" ]]; then
  return 0
fi
AGENT_WINDOW_LIB_TMUX_SESSION_SH=1

session_control() {
  PYTHONPATH="$REPO_ROOT${PYTHONPATH:+:$PYTHONPATH}" python3 -m tmux.context "$@"
}
