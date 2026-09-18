from __future__ import annotations

import re


def agents_except_sender(available_agents: list[str], sender: str | None) -> list[str]:
    return [agent for agent in available_agents if agent != sender and agent != "user"]


def resolve_target_agents(
    target: str,
    available_agents: list[str],
    *,
    sender: str | None = None,
) -> list[str]:
    available = list(available_agents or [])
    available_set = set(available)
    resolved: list[str] = []
    seen: set[str] = set()
    for raw in [item.strip().lower() for item in (target or "").split(",") if item.strip()]:
        if raw == "user":
            candidates = ["user"]
        elif raw == "others":
            candidates = agents_except_sender(available, sender)
        elif raw in available_set:
            candidates = [raw]
        elif re.fullmatch(r".+-\d+", raw):
            candidates = [raw]
        else:
            candidates = [agent for agent in available if agent == raw or agent.startswith(f"{raw}-")]
            if not candidates:
                candidates = [raw]
        for agent in candidates:
            if agent in seen:
                continue
            seen.add(agent)
            resolved.append(agent)
    return resolved
