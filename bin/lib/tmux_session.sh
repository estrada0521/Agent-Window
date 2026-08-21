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
