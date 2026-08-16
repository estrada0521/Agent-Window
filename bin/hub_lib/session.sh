#!/usr/bin/env bash

set -euo pipefail

if [[ -n "${HUB_LIB_SESSION_SH:-}" ]]; then
  return 0
fi
HUB_LIB_SESSION_SH=1

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

repo_log_roots() {
  printf '%s\n' "$AGENT_WINDOW_LOG_DIR"
}

find_archived_index_files() {
  local session_filter="${1:-}" root
  while IFS= read -r root; do
    [[ -d "$root" ]] || continue
    if [[ -n "$session_filter" ]]; then
      find "$root" -maxdepth 2 -type f -path "*/${session_filter}/.log.jsonl" 2>/dev/null
    else
      find "$root" -maxdepth 2 -type f -name '.log.jsonl' 2>/dev/null
    fi
  done < <(repo_log_roots)
}

latest_archived_index_file() {
  local session_filter="${1:-}"
  find_archived_index_files "$session_filter" | sort | tail -n 1
}

matching_archived_sessions() {
  local index_file dir session
  while IFS= read -r index_file; do
    [[ -n "$index_file" ]] || continue
    dir="$(basename "$(dirname "$index_file")")"
    session="$dir"
    [[ -n "$session" ]] && printf '%s\n' "$session"
  done < <(find_archived_index_files)
}

session_workspace_value() {
  local session="$1"
  tmux show-environment -t "$session" AGENT_WINDOW_WORKSPACE 2>/dev/null | sed 's/^[^=]*=//' || true
}

matching_repo_sessions() {
  local session workspace
  while IFS= read -r session; do
    [[ -n "$session" ]] || continue
    workspace="$(session_workspace_value "$session")"
    [[ -n "$workspace" ]] || continue
    printf '%s\n' "$session"
  done < <(tmux list-sessions -F '#S' 2>/dev/null || true)
}

available_agents() {
  local agents_str
  agents_str="$(tmux show-environment -t "$SESSION_NAME" AGENT_WINDOW_AGENTS 2>/dev/null | sed 's/^[^=]*=//' || true)"
  if [[ -n "$agents_str" ]]; then
    printf '%s\n' "$agents_str"
    return
  fi
  printf '\n'
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

resolve_session_name() {
  local matched=()
  if [[ -n "$SESSION_NAME" ]]; then
    printf '%s\n' "$SESSION_NAME"
    return 0
  fi

  if [[ -n "${TMUX:-}" ]]; then
    SESSION_NAME="$(tmux display-message -p '#{session_name}' 2>/dev/null || true)"
    if [[ -n "$SESSION_NAME" ]]; then
      printf '%s\n' "$SESSION_NAME"
      return 0
    fi
  fi

  while IFS= read -r session; do
    [[ -n "$session" ]] && matched+=("$session")
  done < <(matching_repo_sessions)

  if [[ ${#matched[@]} -eq 1 ]]; then
    printf '%s\n' "${matched[0]}"
    return 0
  fi

  if [[ ${#matched[@]} -gt 1 ]]; then
    echo "Multiple active agent-window sessions exist; specify --session." >&2
    return 1
  fi

  matched=()
  while IFS= read -r session; do
    [[ -n "$session" ]] && matched+=("$session")
  done < <(matching_archived_sessions | sort -u)

  if [[ ${#matched[@]} -eq 1 ]]; then
    printf '%s\n' "${matched[0]}"
    return 0
  fi

  if [[ ${#matched[@]} -gt 1 ]]; then
    echo "Multiple archived agent-window sessions exist; specify --session." >&2
    return 1
  fi

  echo "No active or archived agent-window session found for this workspace." >&2
  return 1
}
