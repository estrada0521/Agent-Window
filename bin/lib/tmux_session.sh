#!/usr/bin/env bash

if [[ -n "${AGENT_WINDOW_LIB_TMUX_SESSION_SH:-}" ]]; then
  return 0
fi
AGENT_WINDOW_LIB_TMUX_SESSION_SH=1

# The single entry point into backend_core's session-control logic: an AW
# session's identity is its log folder, and whether/where it's currently
# live in tmux is resolved there (by workspace, never by name-matching),
# not re-derived in bash.
session_control() {
  PYTHONPATH="$REPO_ROOT${PYTHONPATH:+:$PYTHONPATH}" python3 -m backend_core.cli.session_control "$@"
}

# Nothing about which tmux socket a session runs on needs to live inside
# tmux itself: an explicit AGENT_WINDOW_TMUX_SOCKET always wins, and any
# process actually running inside a pane already has it for free via tmux's
# own $TMUX (its first field is the real socket path), so this is the same
# resolution agent-send already uses -- not a second, bash-only guess.
resolve_tmux_socket_name() {
  PYTHONPATH="$REPO_ROOT${PYTHONPATH:+:$PYTHONPATH}" python3 -c '
import os

from message_delivery.send import tmux_socket_from_env

print(tmux_socket_from_env(dict(os.environ)))
'
}

session_json_field() {
  local json="$1" field="$2"
  python3 -c '
import json, sys

value = json.loads(sys.argv[1]).get(sys.argv[2])
if isinstance(value, bool):
    print(1 if value else 0)
elif value is None:
    print("")
else:
    print(value)
' "$json" "$field"
}
