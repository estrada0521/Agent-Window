from __future__ import annotations


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
