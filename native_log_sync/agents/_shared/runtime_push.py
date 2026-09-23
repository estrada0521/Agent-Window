from __future__ import annotations

import threading
from collections import deque


MIN_RUNTIME_DISPLAY_SECONDS = 0.5
MAX_RUNTIME_DISPLAY_QUEUE = 20


def _runtime_event_payload(runtime, agent: str, keyword: str, detail: str, source_id: str) -> dict:
    runtime._idle_running_event_seq += 1
    return {
        "current_event": {
            "id": f"{agent}:{runtime._idle_running_event_seq}",
            "keyword": keyword,
            "detail": detail,
            "source_id": source_id,
        }
    }


def _publish_next_runtime_display(runtime, agent: str) -> None:
    with runtime._idle_running_display_lock:
        queues = runtime._idle_running_display_queues
        timers = runtime._idle_running_display_timers
        queue = queues.get(agent)
        if not queue:
            timers.pop(agent, None)
            return
        keyword, detail, source_id = queue.popleft()
        runtime._idle_running_display_by_agent[agent] = _runtime_event_payload(
            runtime, agent, keyword, detail, source_id
        )
        timer = threading.Timer(MIN_RUNTIME_DISPLAY_SECONDS, _publish_next_runtime_display, args=(runtime, agent))
        timer.daemon = True
        timers[agent] = timer
        timer.start()
    runtime.publish_event("state")


def push_runtime_display(runtime, agent: str, events: list[dict]) -> None:
    normalized: list[tuple[str, str, str]] = []
    for ev in events:
        item = (ev["keyword"], ev["detail"], ev["source_id"])
        if normalized and normalized[-1] == item:
            continue
        normalized.append(item)

    with runtime._idle_running_display_lock:
        queues = runtime._idle_running_display_queues
        timers = runtime._idle_running_display_timers
        queue = queues.setdefault(agent, deque(maxlen=MAX_RUNTIME_DISPLAY_QUEUE))
        current = runtime._idle_running_display_by_agent.get(agent)
        current_key = (
            (current["current_event"]["keyword"], current["current_event"]["detail"], current["current_event"]["source_id"])
            if current
            else None
        )
        for item in normalized:
            if item == current_key:
                continue
            if queue and queue[-1] == item:
                continue
            queue.append(item)
        should_publish_now = agent not in timers

    if should_publish_now:
        _publish_next_runtime_display(runtime, agent)
