from __future__ import annotations

from agents.binding import binding_for_path
from agents.antigravity.resolve_path import resolve_antigravity_native_log


def resolve_native_log_binding(request):
    path = resolve_antigravity_native_log(request.pane_pid)
    return binding_for_path(
        agent=request.agent,
        path=path or "",
    )
