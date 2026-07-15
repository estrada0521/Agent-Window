from __future__ import annotations

from native_log_sync.refresh.binding_models import binding_for_path
from .resolve_path import resolve_cursor_session_jsonl_path


def resolve_native_log_binding(runtime, request):
    return binding_for_path(
        agent=request.agent,
        pane_id=request.pane_id,
        pane_pid=request.pane_pid,
        path=resolve_cursor_session_jsonl_path(
            runtime,
            request.pane_pid,
        ),
        source="cursor-session",
    )


def on_pane_restart(runtime, agent: str) -> None:
    # Path resolves dynamically via lsof on the new PID tree.
    pass


def on_pane_add(runtime, agent: str) -> None:
    pass
