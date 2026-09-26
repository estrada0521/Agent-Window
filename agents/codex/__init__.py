from __future__ import annotations

from agents.binding_models import binding_for_path

from agents.codex.resolve_path import resolve_codex_rollout_jsonl_path


def resolve_native_log_binding(state, request):
    path = resolve_codex_rollout_jsonl_path(request.pane_pid)
    return binding_for_path(
        agent=request.agent,
        path=path,
    )
