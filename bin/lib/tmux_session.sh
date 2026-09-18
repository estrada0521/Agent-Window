#!/usr/bin/env bash

if [[ -n "${AGENT_WINDOW_LIB_TMUX_SESSION_SH:-}" ]]; then
  return 0
fi
AGENT_WINDOW_LIB_TMUX_SESSION_SH=1

session_control() {
  PYTHONPATH="$REPO_ROOT${PYTHONPATH:+:$PYTHONPATH}" python3 -m backend_core.cli.session_control "$@"
}

resolve_tmux_socket_name() {
  PYTHONPATH="$REPO_ROOT${PYTHONPATH:+:$PYTHONPATH}" python3 -c '
import os

from message_delivery.send import tmux_socket_from_env

print(tmux_socket_from_env(dict(os.environ)))
'
}
