from __future__ import annotations

from native_log_sync.dispatch import sync_agent


def emit_agent_updates(runtime, agent: str, path: str) -> None:
    runtime._first_seen_for_agent(agent)
    sync_agent(runtime, agent, path)




def clear_agent_runtime_display(runtime, agent: str) -> bool:
    lock = getattr(runtime, "_idle_running_display_lock", None)
    if lock is not None:
        with lock:
            queue = getattr(runtime, "_idle_running_display_queues", {})
            timer_by_agent = getattr(runtime, "_idle_running_display_timers", {})
            queue.pop(agent, None)
            timer = timer_by_agent.pop(agent, None)
            if timer:
                timer.cancel()
    removed = runtime._idle_running_display_by_agent.pop(agent, None)
    return removed is not None


def idle_running_display_for_api(display_by_agent: dict[str, dict]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for agent, payload in display_by_agent.items():
        if not isinstance(payload, dict):
            continue
        raw_event = payload.get("current_event")
        if not isinstance(raw_event, dict):
            continue
        event_id = str(raw_event.get("id") or "").strip()
        text = str(raw_event.get("text") or "").rstrip()
        if not event_id or not text:
            continue
        result[agent] = {"current_event": {"id": event_id, "text": text}}
    return result


def refresh_idle_statuses(runtime, running_agents: set) -> dict[str, str]:
    result: dict[str, str] = {}
    for agent in runtime.active_agents():
        result[agent] = "running" if agent in running_agents else "idle"
        if result[agent] != "running":
            clear_agent_runtime_display(runtime, agent)
    return result
