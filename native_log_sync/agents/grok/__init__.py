from __future__ import annotations

from native_log_sync.refresh.binding_models import binding_for_path

from .resolve_path import resolve_grok_updates_path


def resolve_native_log_binding(runtime, request):
    return binding_for_path(
        agent=request.agent,
        path=resolve_grok_updates_path(runtime, request.pane_pid),
    )
