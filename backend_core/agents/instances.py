from __future__ import annotations


def parse_agents_csv(agents_csv: str) -> list[str]:
    raw = (agents_csv or "").strip()
    if not raw or raw == "-":
        return []
    return [item.strip() for item in raw.split(",") if item.strip() and item.strip() != "-"]


def agents_to_csv(agents: list[str]) -> str:
    return ",".join([agent for agent in (agents or []) if agent])


def next_instance_name(current_agents: list[str], base_agent: str) -> str:
    base = (base_agent or "").strip()
    if not base:
        return ""
    if base not in (current_agents or []):
        return base
    prefix = f"{base}-"
    max_n = 1
    for instance in current_agents or []:
        if not instance.startswith(prefix):
            continue
        suffix = instance[len(prefix) :]
        if not suffix.isdigit():
            continue
        max_n = max(max_n, int(suffix))
    return f"{base}-{max_n + 1}"


def resolve_canonical_instance(current_agents: list[str], requested_name: str) -> str | None:
    target = (requested_name or "").strip().lower()
    if not target:
        return None
    for agent in current_agents or []:
        if agent.strip().lower() == target:
            return agent
    return None


def append_instance(current_agents: list[str], instance_name: str) -> list[str]:
    agents = [agent for agent in (current_agents or []) if agent]
    instance = (instance_name or "").strip()
    if instance:
        agents.append(instance)
    return agents


def remove_instance(current_agents: list[str], canonical_instance: str) -> list[str]:
    return [agent for agent in (current_agents or []) if agent and agent != canonical_instance]
