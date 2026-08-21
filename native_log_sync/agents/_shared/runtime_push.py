from __future__ import annotations

import threading
from collections import deque


MIN_RUNTIME_DISPLAY_SECONDS = 0.75
# Bounds how far the display can lag live activity: at one item per
# MIN_RUNTIME_DISPLAY_SECONDS, this is ~15s of worst-case backlog. Beyond
# that, older queued events are dropped in favor of newer ones.
MAX_RUNTIME_DISPLAY_QUEUE = 20


def _runtime_event_payload(runtime, agent: str, text: str, source_id: str) -> dict:
    runtime._idle_running_event_seq += 1
    return {
        "current_event": {
            "id": f"{agent}:{runtime._idle_running_event_seq}",
            "text": text,
            "source_id": source_id,
        }
    }


def _publish_next_runtime_display(runtime, agent: str) -> None:
    lock = getattr(runtime, "_idle_running_display_lock", None)
    if lock is None:
        return
    with lock:
        queues = getattr(runtime, "_idle_running_display_queues", {})
        timers = getattr(runtime, "_idle_running_display_timers", {})
        queue = queues.get(agent)
        if not queue:
            timers.pop(agent, None)
            return
        text, source_id = queue.popleft()
        runtime._idle_running_display_by_agent[agent] = _runtime_event_payload(runtime, agent, text, source_id)
        timer = threading.Timer(MIN_RUNTIME_DISPLAY_SECONDS, _publish_next_runtime_display, args=(runtime, agent))
        timer.daemon = True
        timers[agent] = timer
        runtime._idle_running_display_timers = timers
        timer.start()
    runtime.notify_session_state_changed(["agent_runtime"], reason="agent-runtime")


def push_runtime_display(runtime, agent: str, events: list[dict]) -> None:
    normalized: list[tuple[str, str]] = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        text = str(ev.get("text") or "").strip()
        if not text:
            continue
        source_id = str(ev.get("source_id") or "").strip()
        if normalized and normalized[-1] == (text, source_id):
            continue
        normalized.append((text, source_id))
    if not normalized:
        return

    lock = getattr(runtime, "_idle_running_display_lock", None)
    if lock is None:
        runtime._idle_running_display_by_agent[agent] = _runtime_event_payload(runtime, agent, *normalized[-1])
        runtime.notify_session_state_changed(["agent_runtime"], reason="agent-runtime")
        return

    should_publish_now = False
    with lock:
        queues = getattr(runtime, "_idle_running_display_queues", {})
        timers = getattr(runtime, "_idle_running_display_timers", {})
        queue = queues.setdefault(agent, deque(maxlen=MAX_RUNTIME_DISPLAY_QUEUE))
        current_event = ((runtime._idle_running_display_by_agent.get(agent) or {}).get("current_event") or {})
        current_key = (
            str(current_event.get("text") or "").strip(),
            str(current_event.get("source_id") or "").strip(),
        )
        for item in normalized:
            if item == current_key:
                continue
            if queue and queue[-1] == item:
                continue
            queue.append(item)
        runtime._idle_running_display_queues = queues
        should_publish_now = agent not in timers

    if should_publish_now:
        _publish_next_runtime_display(runtime, agent)
