from __future__ import annotations

from agents.binding import binding_for_path

from agents.grok.resolve_path import resolve_grok_updates_path


def resolve_native_log_binding(request):
    return binding_for_path(
        agent=request.agent,
        path=resolve_grok_updates_path(request.pane_pid),
    )
