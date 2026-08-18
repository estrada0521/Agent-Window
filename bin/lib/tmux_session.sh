#!/usr/bin/env bash

if [[ -n "${AGENT_WINDOW_LIB_TMUX_SESSION_SH:-}" ]]; then
  return 0
fi
AGENT_WINDOW_LIB_TMUX_SESSION_SH=1

session_workspace_value() {
  local session="$1"
  tmux show-environment -t "$session" AGENT_WINDOW_WORKSPACE 2>/dev/null | sed 's/^[^=]*=//' || true
}
