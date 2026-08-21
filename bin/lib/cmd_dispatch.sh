agent_window_dispatch_prelaunch_modes() {
  if [[ "$MODE" == "status" ]]; then
    command -v tmux >/dev/null 2>&1 || { echo "tmux is required." >&2; exit 1; }
    if [[ "$ALL_SESSIONS" -eq 1 ]]; then
      found=0
      while IFS= read -r session; do
        [[ -z "$session" ]] && continue
        session_control describe --session "$session" --tmux-socket "$TMUX_SOCKET_NAME"
        echo
        found=1
      done < <(repo_session_names)
      [[ "$found" -eq 1 ]] || echo "No sessions found for this agent-window install"
      exit 0
    fi
    if [[ -z "$SESSION_NAME" ]] && [[ "$SESSION_NAME_EXPLICIT" -eq 0 ]]; then
      SESSION_NAME="$(resolve_target_session_name)" || exit 1
    fi
    if [[ -z "$SESSION_NAME" ]]; then
      echo "Session does not exist" >&2
      exit 1
    fi
    session_control describe --session "$SESSION_NAME" --tmux-socket "$TMUX_SOCKET_NAME"
    exit $?
  fi

  if [[ "$MODE" == "context" ]]; then
    command -v tmux >/dev/null 2>&1 || { echo "tmux is required." >&2; exit 1; }
    local args=(context --workspace "$WORKSPACE" --tmux-socket "$TMUX_SOCKET_NAME")
    [[ "$SESSION_NAME_EXPLICIT" -eq 1 ]] && args+=(--session "$SESSION_NAME")
    [[ "$CONTEXT_JSON" -eq 1 ]] && args+=(--json)
    session_control "${args[@]}"
    exit $?
  fi

  if [[ "$MODE" == "list" ]]; then
    command -v tmux >/dev/null 2>&1 || { echo "tmux is required." >&2; exit 1; }
    local args=(list --tmux-socket "$TMUX_SOCKET_NAME")
    [[ "$ALL_SESSIONS" -eq 1 ]] && args+=(--all)
    [[ "$LIST_VERBOSE" -eq 1 ]] && args+=(--verbose)
    session_control "${args[@]}"
    exit $?
  fi

  if [[ "$MODE" == "kill" ]]; then
    command -v tmux >/dev/null 2>&1 || { echo "tmux is required." >&2; exit 1; }
    if [[ "$ALL_SESSIONS" -eq 1 ]]; then
      killed=0
      while IFS= read -r session; do
        [[ -z "$session" ]] && continue
        session_control kill --session "$session" --tmux-socket "$TMUX_SOCKET_NAME" || exit 1
        killed=1
      done < <(repo_session_names)
      [[ "$killed" -eq 1 ]] || { echo "No sessions found for this agent-window install"; exit 1; }
      exit 0
    fi
    if [[ -z "$SESSION_NAME" ]] && [[ "$SESSION_NAME_EXPLICIT" -eq 0 ]]; then
      SESSION_NAME="$(resolve_target_session_name)" || exit 1
    fi
    if [[ -z "$SESSION_NAME" ]]; then
      echo "Session does not exist" >&2
      exit 1
    fi
    session_control kill --session "$SESSION_NAME" --tmux-socket "$TMUX_SOCKET_NAME"
    exit $?
  fi
}

agent_window_dispatch_agent_mutation_modes() {
  if [[ "$MODE" != "add-agent" && "$MODE" != "remove-agent" ]]; then
    return 0
  fi
  command -v tmux >/dev/null 2>&1 || { echo "tmux is required." >&2; exit 1; }
  [[ -n "$AGENTS_ARG" ]] || { echo "--agent is required for $MODE" >&2; exit 1; }
  if [[ -z "$SESSION_NAME" ]] && [[ "$SESSION_NAME_EXPLICIT" -eq 0 ]]; then
    SESSION_NAME="$(resolve_target_session_name)" || exit 1
  fi
  if [[ -z "$SESSION_NAME" ]]; then
    echo "Session does not exist" >&2
    exit 1
  fi
  session_control "$MODE" --session "$SESSION_NAME" --agent "$AGENTS_ARG" --tmux-socket "$TMUX_SOCKET_NAME"
  exit $?
}
