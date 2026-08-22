#!/usr/bin/env bash

set -euo pipefail

if [[ -n "${HUB_LIB_SESSION_SH:-}" ]]; then
  return 0
fi
HUB_LIB_SESSION_SH=1

# shellcheck source=/dev/null
source "$REPO_ROOT/bin/lib/tmux_session.sh"

hub_session_log_dir() {
  local session="$1"
  printf '%s/%s\n' "$AGENT_WINDOW_LOG_DIR" "$session"
}

resolve_session_workspace() {
  PYTHONPATH="$HUB_PYTHONPATH" python3 - "$1" <<'PYEOF'
import sys

from backend_core.access.session_meta import SessionMetaError, session_workspace

try:
    workspace = session_workspace(sys.argv[1])
except SessionMetaError as exc:
    raise SystemExit(str(exc)) from exc
if workspace:
    print(workspace)
PYEOF
}

# A valid workspace binding resolves to exactly one session. Manual
# duplicate claims and unreadable metadata are errors, not an arbitrary
# "first match" choice. Delegates to the same .meta-scanning helper that
# guards session creation instead of re-deriving matching semantics in
# bash. Prefers
# AGENT_WINDOW_WORKSPACE (set once at session creation, stable even if this
# process's own cwd has since moved) over the current directory.
resolve_workspace_session() {
  PYTHONPATH="$HUB_PYTHONPATH" python3 - "${AGENT_WINDOW_WORKSPACE:-$PWD}" <<'PYEOF'
import sys
from pathlib import Path

from backend_core.access.session_meta import SessionMetaError, find_session_for_workspace

try:
    found = find_session_for_workspace(Path(sys.argv[1]))
except SessionMetaError as exc:
    raise SystemExit(str(exc)) from exc
if found:
    print(found)
PYEOF
}

resolve_session_log_dir() {
  local session_dir
  session_dir="$(hub_session_log_dir "$SESSION_NAME")"
  mkdir -p "$session_dir"
  printf '%s\n' "$session_dir"
}

# tmux never knows an AW session's own name -- only the workspace it runs
# in -- so "which AW session am I in" can only be answered by that
# workspace, never by asking tmux for its own session name directly (that
# name is workspace-derived internal tmux plumbing, not the AW identity).
resolve_session_name() {
  if [[ -n "$SESSION_NAME" ]]; then
    printf '%s\n' "$SESSION_NAME"
    return 0
  fi

  local workspace_session
  workspace_session="$(resolve_workspace_session)"
  if [[ -n "$workspace_session" ]]; then
    printf '%s\n' "$workspace_session"
    return 0
  fi

  echo "No agent-window session found for this workspace; specify --session." >&2
  return 1
}
