from __future__ import annotations

from agents.binding_models import binding_for_path
from agents.cursor.resolve_path import resolve_cursor_session_jsonl_path


def resolve_native_log_binding(runtime, request):
    return binding_for_path(
        agent=request.agent,
        path=resolve_cursor_session_jsonl_path(request.pane_pid),
    )
