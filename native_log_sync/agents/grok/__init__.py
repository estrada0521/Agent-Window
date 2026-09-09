from __future__ import annotations

from native_log_sync.refresh.binding_models import binding_for_path

from .resolve_path import resolve_grok_updates_path


def resolve_native_log_binding(runtime, request):
    return binding_for_path(
        agent=request.agent,
        pane_id=request.pane_id,
        pane_pid=request.pane_pid,
        path=resolve_grok_updates_path(runtime, request.pane_pid),
        source="grok-updates",
    )


def on_pane_restart(runtime, agent: str) -> None:
    runtime._native_log_current_paths.pop(agent, None)


def on_pane_add(runtime, agent: str) -> None:
    pass
