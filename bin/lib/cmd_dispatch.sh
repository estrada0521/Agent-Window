agent_window_dispatch_prelaunch_modes() {
  if [[ "$MODE" == "status" ]]; then
    command -v tmux >/dev/null 2>&1 || { echo "tmux is required." >&2; exit 1; }
    if [[ "$ALL_SESSIONS" -eq 1 ]]; then
      found=0
      while IFS= read -r session; do
        [[ -z "$session" ]] && continue
        show_status "$session"
        echo
        found=1
      done < <(repo_sessions)
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
    show_status "$SESSION_NAME"
    exit 0
  fi

  if [[ "$MODE" == "context" ]]; then
    command -v tmux >/dev/null 2>&1 || { echo "tmux is required." >&2; exit 1; }
    resolved_note=""
    if [[ -z "$SESSION_NAME" ]] && [[ "$SESSION_NAME_EXPLICIT" -eq 0 ]]; then
      if [[ -n "${AGENT_WINDOW_SESSION:-}" ]]; then
        SESSION_NAME="$AGENT_WINDOW_SESSION"
      fi
    fi
    if [[ -z "$SESSION_NAME" ]] && [[ "$SESSION_NAME_EXPLICIT" -eq 0 ]]; then
      if [[ -n "${TMUX:-}" ]]; then
        SESSION_NAME="$(tmux display-message -p '#{session_name}' 2>/dev/null || true)"
      fi
    fi
    if [[ -z "$SESSION_NAME" ]] && [[ "$SESSION_NAME_EXPLICIT" -eq 0 ]]; then
      SESSION_NAME="$(resolve_target_session_name)" || exit 1
    fi
    if [[ -z "$SESSION_NAME" ]]; then
      echo "Session does not exist or could not be resolved (set AGENT_WINDOW_SESSION or run inside tmux)." >&2
      exit 1
    fi
    if ! tmux has-session -t "=$SESSION_NAME" 2>/dev/null; then
      echo "tmux session not found: $SESSION_NAME" >&2
      exit 1
    fi
    if [[ "$SESSION_NAME_EXPLICIT" -eq 1 ]]; then
      resolved_note="--session"
    elif [[ -n "${AGENT_WINDOW_SESSION:-}" && "$SESSION_NAME" == "${AGENT_WINDOW_SESSION}" ]]; then
      resolved_note="AGENT_WINDOW_SESSION"
    elif [[ -n "${TMUX:-}" ]]; then
      resolved_note="tmux client (#{session_name})"
    else
      resolved_note="resolve_target_session_name"
    fi
    print_agent_context "$SESSION_NAME" "$resolved_note"
    exit 0
  fi

  if [[ "$MODE" == "list" ]]; then
    command -v tmux >/dev/null 2>&1 || { echo "tmux is required." >&2; exit 1; }
    list_sessions
    exit 0
  fi

  if [[ "$MODE" == "resume" ]]; then
    command -v tmux >/dev/null 2>&1 || { echo "tmux is required." >&2; exit 1; }
    if [[ -z "$SESSION_NAME" ]] && [[ "$SESSION_NAME_EXPLICIT" -eq 0 ]]; then
      SESSION_NAME="$(resolve_target_session_name)" || exit 1
    fi
    if [[ -z "$SESSION_NAME" ]]; then
      echo "Session does not exist" >&2
      exit 1
    fi
    if ! tmux has-session -t "=$SESSION_NAME" 2>/dev/null; then
      echo "Session does not exist: $SESSION_NAME" >&2
      exit 1
    fi
    [[ "$DETACH" -eq 1 ]] && { echo "Session exists: $SESSION_NAME"; exit 0; }
    exec_tmux attach-session -t "$SESSION_NAME"
  fi

  if [[ "$MODE" == "kill" ]]; then
    command -v tmux >/dev/null 2>&1 || { echo "tmux is required." >&2; exit 1; }
    if [[ "$ALL_SESSIONS" -eq 1 ]]; then
      killed=0
      while IFS= read -r session; do
        [[ -z "$session" ]] && continue
        session_control kill --session "$session" --tmux-socket "$TMUX_SOCKET_NAME" || exit 1
        killed=1
      done < <(repo_sessions)
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

  if [[ "$MODE" == "rename" ]]; then
    command -v tmux >/dev/null 2>&1 || { echo "tmux is required." >&2; exit 1; }
    [[ -n "$RENAME_TO" ]] || { echo "rename requires --to NEW_NAME" >&2; exit 1; }
    if [[ -z "$SESSION_NAME" ]] && [[ "$SESSION_NAME_EXPLICIT" -eq 0 ]]; then
      SESSION_NAME="$(resolve_target_session_name)" || exit 1
    fi
    if [[ -z "$SESSION_NAME" ]]; then
      echo "Session does not exist" >&2
      exit 1
    fi
    if ! tmux has-session -t "=$SESSION_NAME" 2>/dev/null; then
      echo "Session does not exist: $SESSION_NAME" >&2
      exit 1
    fi
    if tmux has-session -t "=$RENAME_TO" 2>/dev/null; then
      echo "Session already exists: $RENAME_TO" >&2
      exit 1
    fi
    tmux rename-session -t "$SESSION_NAME" "$RENAME_TO"
    echo "Renamed tmux session: $SESSION_NAME -> $RENAME_TO"
    exit 0
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
