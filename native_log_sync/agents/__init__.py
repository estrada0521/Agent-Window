from __future__ import annotations

from importlib import import_module


def _agent_module(agent: str):
    base = str(agent or "").strip().lower().split("-", 1)[0]
    try:
        return import_module(f"native_log_sync.agents.{base}")
    except ModuleNotFoundError:
        return None


def resolve_binding(runtime, request):
    mod = _agent_module(request.agent)
    if mod is None:
        return None
    resolver = getattr(mod, "resolve_native_log_binding", None)
    if resolver is None:
        return None
    return resolver(runtime, request)


def on_pane_restart(runtime, agent: str) -> None:
    mod = _agent_module(agent)
    if mod is None:
        return
    hook = getattr(mod, "on_pane_restart", None)
    if hook is not None:
        hook(runtime, agent)


def on_pane_add(runtime, agent: str) -> None:
    mod = _agent_module(agent)
    if mod is None:
        return
    hook = getattr(mod, "on_pane_add", None)
    if hook is not None:
        hook(runtime, agent)
