from __future__ import annotations


def clear_agent_runtime_display(runtime, agent: str) -> bool:
    with runtime._idle_running_display_lock:
        queue = runtime._idle_running_display_queues
        timer_by_agent = runtime._idle_running_display_timers
        queue.pop(agent, None)
        timer = timer_by_agent.pop(agent, None)
        if timer:
            timer.cancel()
    removed = runtime._idle_running_display_by_agent.pop(agent, None)
    return removed is not None


def idle_running_display_for_api(display_by_agent: dict[str, dict]) -> dict[str, dict]:
    return {
        agent: {
            "current_event": {
                "id": payload["current_event"]["id"],
                "keyword": payload["current_event"]["keyword"],
                "detail": payload["current_event"]["detail"],
            }
        }
        for agent, payload in display_by_agent.items()
    }


def refresh_idle_statuses(runtime, running_agents: set) -> dict[str, str]:
    result: dict[str, str] = {}
    for agent in runtime.active_agents():
        result[agent] = "running" if agent in running_agents else "idle"
        if result[agent] != "running":
            clear_agent_runtime_display(runtime, agent)
    return result
