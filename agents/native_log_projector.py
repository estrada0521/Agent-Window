from __future__ import annotations

import threading
import time
from collections import deque
from pathlib import Path
from typing import Callable

from agents import agent_base_name
from agents.antigravity.read_updates import project_antigravity_native_log
from agents.antigravity.resolve_path import resolve_antigravity_native_log
from agents.claude.read_updates import project_claude_native_log
from agents.claude.resolve_path import resolve_claude_session_jsonl_path
from agents.codex.read_updates import project_codex_native_log
from agents.codex.resolve_path import resolve_codex_rollout_jsonl_path
from agents.cursor.read_updates import project_cursor_native_log
from agents.cursor.resolve_path import resolve_cursor_session_jsonl_path
from agents.grok.read_updates import project_grok_native_log
from agents.grok.resolve_path import resolve_grok_updates_path
from agents.native_log_watcher import NativeLogWatcher
from fs.log.jsonl import append_jsonl_entry
from tmux.session import pane_field

BIND_INTERVAL_SECONDS = 0.5
BIND_TIMEOUT_SECONDS = 3.0
MIN_RUNNING_DISPLAY_SECONDS = 0.5
MAX_RUNNING_DISPLAY_QUEUE = 20

_RESOLVE_BY_BASE = {
    "claude": resolve_claude_session_jsonl_path,
    "codex": lambda _pane_id, pane_pid: resolve_codex_rollout_jsonl_path(pane_pid),
    "cursor": lambda _pane_id, pane_pid: resolve_cursor_session_jsonl_path(pane_pid),
    "antigravity": lambda _pane_id, pane_pid: resolve_antigravity_native_log(pane_pid),
    "grok": lambda _pane_id, pane_pid: resolve_grok_updates_path(pane_pid),
}

_PROJECT_BY_BASE = {
    "claude": project_claude_native_log,
    "codex": project_codex_native_log,
    "cursor": project_cursor_native_log,
    "antigravity": project_antigravity_native_log,
    "grok": project_grok_native_log,
}


class NativeLogProjector:
    def __init__(
        self,
        *,
        workspace: str,
        log_path: Callable[[], Path],
        agent_panes: Callable[[], dict[str, str]],
        publish_state: Callable[[], None],
        report_failure: Callable[[str, str], None],
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
        self._bindings: dict[str, str] = {}
        self._bindings_lock = threading.Lock()
        self._project_lock = threading.Lock()
        self._watcher: NativeLogWatcher | None = None
        self._thread: threading.Thread | None = None
        self._stopped = False
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
        self.refresh_bindings()
        self._watcher = NativeLogWatcher(self, self._publish_state)
        self._thread = threading.Thread(target=self._watcher.run, daemon=True, name="native-vnode")
        self._thread.start()

    def stop(self) -> None:
        self._stopped = True
        if self._thread and self._thread.is_alive():
            self._watcher.stop()
            self._thread.join()
        with self._running_lock:
            for timer in self._running_timers.values():
                timer.cancel()
            self._running_timers.clear()
            self._running_queues.clear()
            self._running_display.clear()

    def bindings(self) -> dict[str, str]:
        with self._bindings_lock:
            return dict(self._bindings)

    def refresh_bindings(self, agents: list[str] | None = None) -> None:
        panes_by_agent = self._agent_panes()
        target_agents = [
            agent
            for agent in (agents if agents is not None else panes_by_agent)
            if panes_by_agent.get(agent)
        ]
        resolved: dict[str, str] = {}
        for agent in target_agents:
            if self._stopped:
                return
            pane_id = panes_by_agent[agent]
            try:
                path = _RESOLVE_BY_BASE[agent_base_name(agent)](pane_id, pane_field(pane_id, "#{pane_pid}"))
                if not path:
                    continue
                self.project(agent, path, start_at_end=True)
            except Exception as exc:
                self.failed(agent, f"projection failed: {exc}")
                continue
            resolved[agent] = path
        with self._bindings_lock:
            next_by_agent = {} if agents is None else dict(self._bindings)
            for agent in target_agents:
                next_by_agent.pop(agent, None)
            next_by_agent.update(resolved)
            self._bindings = next_by_agent
        self._wake_watcher()

    def remove_binding(self, agent: str) -> None:
        with self._bindings_lock:
            self._bindings.pop(agent, None)
        self._wake_watcher()

    def _wake_watcher(self) -> None:
        if self._watcher is not None and not self._stopped:
            self._watcher.wake()

    def failed(self, agent: str, detail: str) -> None:
        self.remove_binding(agent)
        self.mark_idle(agent)
        self.report_failure(agent, detail)

    def rebind(self, agent: str) -> None:
        if self._agent_panes().get(agent):
            self.refresh_bindings([agent])
        else:
            self.remove_binding(agent)

    def project(self, agent: str, path: str, *, start_at_end: bool = False) -> None:
        project_fn = _PROJECT_BY_BASE[agent_base_name(agent)]
        with self._project_lock:
            project_fn(self, agent, path, start_at_end=start_at_end)

    def append_reply(self, agent: str, path: str, offset: int, message: str) -> None:
        append_jsonl_entry(
            self.log_path,
            {
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "sender": agent,
                "targets": ["user"],
                "message": message,
                "native_log_path": path,
                "native_log_offset": offset,
            },
        )

    def bind_after_send(self, agent: str) -> None:
        with self._bind_workers_lock:
            if agent in self._bind_workers:
                return
            self._bind_workers.add(agent)

        def bind() -> None:
            deadline = time.monotonic() + BIND_TIMEOUT_SECONDS
            try:
                while not self._stopped and agent in self._agent_panes():
                    try:
                        self.refresh_bindings([agent])
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
        if self._stopped:
            return
        self.mark_running(agent)
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
            if self._stopped:
                return
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
