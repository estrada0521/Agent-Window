from __future__ import annotations

from importlib import import_module

from backend_core.agents.names import agent_base_name
from backend_core.agents.registry import canonical_agent_name


def _agent_module(agent: str):
    base = canonical_agent_name(agent_base_name(agent))
    return import_module(f"native_log_sync.agents.{base}")


def resolve_binding(runtime, request):
    resolver = getattr(_agent_module(request.agent), "resolve_native_log_binding", None)
    if resolver is None:
        raise RuntimeError(f"no native log resolver for {request.agent}")
    return resolver(runtime, request)


def on_pane_restart(runtime, agent: str) -> None:
    hook = getattr(_agent_module(agent), "on_pane_restart", None)
    if hook is not None:
        hook(runtime, agent)


def on_pane_add(runtime, agent: str) -> None:
    hook = getattr(_agent_module(agent), "on_pane_add", None)
    if hook is not None:
        hook(runtime, agent)
