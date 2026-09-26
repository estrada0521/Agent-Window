from __future__ import annotations

from importlib import import_module
import re


def _agent_module(agent: str):
    base = agent_base_name(agent)
    return import_module(f"agents.{base}")


def resolve_binding(request):
    resolver = getattr(_agent_module(request.agent), "resolve_native_log_binding", None)
    if resolver is None:
        raise RuntimeError(f"no native log resolver for {request.agent}")
    return resolver(request)


def agent_base_name(raw_name: str) -> str:
    return re.sub(r"-\d+$", "", str(raw_name or "").strip().lower())


def next_instance_name(current_agents: list[str], base_agent: str) -> str:
    if base_agent not in current_agents:
        return base_agent
    prefix = f"{base_agent}-"
    max_n = 1
    for instance in current_agents:
        if not instance.startswith(prefix):
            continue
        suffix = instance[len(prefix) :]
        if not suffix.isdigit():
            continue
        max_n = max(max_n, int(suffix))
    return f"{base_agent}-{max_n + 1}"
