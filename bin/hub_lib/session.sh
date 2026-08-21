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

hub_ensure_session_log() {
  local session="$1" session_dir index_path
  session_dir="$(hub_session_log_dir "$session")"
  index_path="${session_dir}/.log.jsonl"
  mkdir -p "$session_dir"
  [[ -e "$index_path" ]] || : > "$index_path"
  [[ -n "${SESSION_WORKSPACE:-}" ]] || return 0
  PYTHONPATH="$HUB_PYTHONPATH" python3 - "$session" "$SESSION_WORKSPACE" <<'PYEOF'
import sys

from backend_core.access.settings import ensure_session_workspace_mirrors

ensure_session_workspace_mirrors(sys.argv[1], sys.argv[2])
PYEOF
}

# A workspace has at most one session, active or archived (enforced at
# creation in backend_core.tmux.control.create_session), so this is a
# lookup, not a "which of these did you mean" search. Delegates to the
# same .meta-scanning helper that guards session creation, instead of
# re-deriving matching semantics separately in bash. Prefers
# AGENT_WINDOW_WORKSPACE (set once at session creation, stable even if this
# process's own cwd has since moved) over the current directory.
resolve_workspace_session() {
  PYTHONPATH="$HUB_PYTHONPATH" python3 - "${AGENT_WINDOW_WORKSPACE:-$PWD}" <<'PYEOF'
import sys
from pathlib import Path

from backend_core.access.session_meta import find_session_for_workspace

found = find_session_for_workspace(Path(sys.argv[1]))
if found:
    print(found)
PYEOF
}

resolve_session_log_dir() {
  local session_dir
  if [[ "${SESSION_IS_ACTIVE:-0}" == "1" && -n "$SESSION_NAME" ]]; then
    hub_ensure_session_log "$SESSION_NAME"
    printf '%s\n' "$(hub_session_log_dir "$SESSION_NAME")"
    return
  fi
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
