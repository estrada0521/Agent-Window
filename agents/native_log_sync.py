from __future__ import annotations

import threading
import time
from collections import deque
from pathlib import Path
from typing import Callable

from agents import agent_base_name, resolve_binding
from agents.binding_models import NativeLogBinding, PaneBindingRequest
from agents.claude.read_updates import sync_claude_native_log
from agents.codex.read_updates import sync_codex_native_log
from agents.cursor.read_updates import sync_cursor_native_log
from agents.gemini.read_updates import sync_gemini_native_log
from agents.grok.read_updates import sync_grok_native_log
from agents.native_log_watcher import NativeLogWatcher
from tmux.session import pane_field

BIND_INTERVAL_SECONDS = 0.5
BIND_TIMEOUT_SECONDS = 3.0
MIN_RUNNING_DISPLAY_SECONDS = 0.5
MAX_RUNNING_DISPLAY_QUEUE = 20

_SYNC_BY_BASE = {
    "claude": sync_claude_native_log,
    "codex": sync_codex_native_log,
    "cursor": sync_cursor_native_log,
    "gemini": sync_gemini_native_log,
    "grok": sync_grok_native_log,
}


class NativeLogSync:
    def __init__(
        self,
        *,
        workspace: str,
        log_path: Callable[[], Path],
        agent_panes: Callable[[], dict[str, str]],
        publish_state: Callable[[], None],
        report_failure: Callable[[str], None],
        mark_idle: Callable[[str], None],
        mark_running: Callable[[str], None],
    ) -> None:
        self.workspace = workspace
        self._log_path = log_path
        self._agent_panes = agent_panes
        self._publish_state = publish_state
        self.report_failure = report_failure
        self.mark_idle = mark_idle
        self.mark_running = mark_running
        self.offsets: dict[str, int] = {}
        self._bindings: dict[str, NativeLogBinding] = {}
        self._bindings_lock = threading.Lock()
        self._sync_lock = threading.Lock()
        self._watcher: NativeLogWatcher | None = None
        self._bind_workers: set[str] = set()
        self._bind_workers_lock = threading.Lock()
        self._running_display: dict[str, dict] = {}
        self._running_event_seq = 0
        self._running_lock = threading.Lock()
        self._running_queues: dict[str, deque] = {}
        self._running_timers: dict[str, threading.Timer] = {}

    @property
    def log_path(self) -> Path:
        return self._log_path()

    def start(self) -> None:
        self.refresh_bindings(start_at_end=True)
        self._watcher = NativeLogWatcher(self)
        threading.Thread(target=self._watcher.run, daemon=True, name="native-vnode").start()

    def bindings(self) -> dict[str, NativeLogBinding]:
        with self._bindings_lock:
            return dict(self._bindings)

    def refresh_bindings(self, agents: list[str] | None = None, *, start_at_end: bool = False) -> None:
        replace_all = agents is None
        panes_by_agent = self._agent_panes()
        target_agents = list(agents) if agents is not None else list(panes_by_agent)
        requests = [
            PaneBindingRequest(agent=agent, pane_id=pane_id, pane_pid=pane_field(pane_id, "#{pane_pid}"))
            for agent in target_agents
            if (pane_id := panes_by_agent.get(agent, ""))
        ]
        resolved: list[NativeLogBinding] = []
        with self._bindings_lock:
            next_by_agent = {} if replace_all else dict(self._bindings)
            for request in requests:
                next_by_agent.pop(request.agent, None)
                binding = resolve_binding(request)
                if binding is None:
                    continue
                resolved.append(binding)
                next_by_agent[binding.agent] = binding
            self._bindings = next_by_agent
        self._wake_watcher()
        for binding in resolved:
            try:
                self.sync(binding.agent, binding.path, start_at_end=start_at_end)
            except Exception as exc:
                self.failed(binding.agent, f"sync failed: {exc}")

    def remove_binding(self, agent: str) -> None:
        with self._bindings_lock:
            self._bindings.pop(agent, None)
        self._wake_watcher()

    def _wake_watcher(self) -> None:
        if self._watcher is not None:
            self._watcher.wake()

    def failed(self, agent: str, detail: str) -> None:
        self.remove_binding(agent)
        self.mark_idle(agent)
        self.report_failure(f"native log failed: {agent}: {detail}")

    def rebind(self, agent: str) -> None:
        if self._agent_panes().get(agent):
            self.refresh_bindings([agent], start_at_end=True)
        else:
            self.remove_binding(agent)

    def sync(self, agent: str, path: str, *, start_at_end: bool = False) -> None:
        sync_fn = _SYNC_BY_BASE.get(agent_base_name(agent))
        if sync_fn is None:
            raise ValueError(f"unknown agent type: {agent}")
        with self._sync_lock:
            sync_fn(self, agent, path, start_at_end=start_at_end)

    def bind_after_send(self, agent: str) -> None:
        with self._bind_workers_lock:
            if agent in self._bind_workers:
                return
            self._bind_workers.add(agent)

        def bind() -> None:
            deadline = time.monotonic() + BIND_TIMEOUT_SECONDS
            try:
                while agent in self._agent_panes():
                    try:
                        self.refresh_bindings([agent], start_at_end=True)
                    except Exception as exc:
                        self.failed(agent, f"bind failed: {exc}")
                        return
                    if agent in self.bindings():
                        return
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        self.failed(agent, f"no native log appeared within {BIND_TIMEOUT_SECONDS:g}s of sending")
                        return
                    time.sleep(min(BIND_INTERVAL_SECONDS, remaining))
            finally:
                with self._bind_workers_lock:
                    self._bind_workers.discard(agent)

        threading.Thread(target=bind, daemon=True, name=f"native-bind-{agent}").start()

    def watched_paths(self) -> dict[str, str]:
        return self._watcher.watched_paths() if self._watcher else {}

    def push_running_display(self, agent: str, events: list[dict]) -> None:
        normalized: list[tuple[str, str, str]] = []
        for ev in events:
            item = (ev["keyword"], ev["detail"], ev["source_id"])
            if normalized and normalized[-1] == item:
                continue
            normalized.append(item)
        with self._running_lock:
            queue = self._running_queues.setdefault(agent, deque(maxlen=MAX_RUNNING_DISPLAY_QUEUE))
            current = self._running_display.get(agent)
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
            should_publish_now = agent not in self._running_timers
        if should_publish_now:
            self._publish_next_running_display(agent)

    def _publish_next_running_display(self, agent: str) -> None:
        with self._running_lock:
            queue = self._running_queues.get(agent)
            if not queue:
                self._running_timers.pop(agent, None)
                return
            keyword, detail, source_id = queue.popleft()
            self._running_event_seq += 1
            self._running_display[agent] = {
                "current_event": {
                    "id": f"{agent}:{self._running_event_seq}",
                    "keyword": keyword,
                    "detail": detail,
                    "source_id": source_id,
                }
            }
            timer = threading.Timer(MIN_RUNNING_DISPLAY_SECONDS, self._publish_next_running_display, args=(agent,))
            timer.daemon = True
            self._running_timers[agent] = timer
            timer.start()
        self._publish_state()

    def clear_running_display(self, agent: str) -> bool:
        with self._running_lock:
            self._running_queues.pop(agent, None)
            timer = self._running_timers.pop(agent, None)
            if timer:
                timer.cancel()
            return self._running_display.pop(agent, None) is not None

    def running_display_for_api(self) -> dict[str, dict]:
        with self._running_lock:
            return {
                agent: {
                    "current_event": {
                        "id": payload["current_event"]["id"],
                        "keyword": payload["current_event"]["keyword"],
                        "detail": payload["current_event"]["detail"],
                    }
                }
                for agent, payload in self._running_display.items()
            }
