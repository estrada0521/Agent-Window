from __future__ import annotations

from agents.binding_models import binding_for_path
from agents.gemini.resolve_path import resolve_gemini_native_log


def resolve_native_log_binding(state, request):
    path = resolve_gemini_native_log(request.pane_pid)
    return binding_for_path(
        agent=request.agent,
        path=path or "",
    )
