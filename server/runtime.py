from __future__ import annotations
import json
import logging

import threading
import time
import uuid
from pathlib import Path

from backend_core.agents.executables import (
    resolve_agent_executable_for_runtime as _resolve_agent_executable_impl,
)
from backend_core.tmux.lifecycle import (
    restart_agent_pane as _restart_agent_pane_impl,
)
from message_delivery import (
    deliver_message as _deliver_message_impl,
    mark_agent_sent as _mark_agent_sent_impl,
)
from .entry_write import (
    append_system_entry as _append_system_entry_impl,
    append_user_entry as _append_user_entry_impl,
)
from .log_reader import newest_entries
from workspace_sync.commit import (
    adopt_commit_baseline as _adopt_commit_baseline_impl,
    ensure_commit_announcements as _ensure_commit_announcements_impl,
)
from native_log_sync.syncer import NativeLogSyncer
from native_log_sync.refresh.binding_models import PaneBindingRequest
from backend_core.tmux.session import (
    agent_topology as _agent_topology_impl,
    pane_field as _pane_field_impl,
    resolve_tmux_session_name as _resolve_tmux_session_name_impl,
    terminal_window_pane_id as _terminal_window_pane_id_impl,
)
from .session_state import build_session_state_payload as _build_session_state_payload_impl
from pane_trace import trace_content as _trace_content_impl
from .session_binding import WorkspaceSessionBinding


ENTRY_WINDOW_LIMIT = 2000
EVENT_KINDS = ("messages", "state", "files", "git")
NATIVE_LOG_BIND_INTERVAL_SECONDS = 0.5
NATIVE_LOG_BIND_TIMEOUT_SECONDS = 3.0


class ChatRuntime:
    def __init__(
        self,
        *,
        port: int,
        workspace: str,
        hub_port: int,
        repo_root: Path | str,
        initial_running_agents: list[str] | None = None,
    ):
        self._session_binding = WorkspaceSessionBinding(workspace)
        self.port = int(port)
        self.workspace = self._session_binding.workspace
        self.hub_port = int(hub_port)
        self.repo_root = Path(repo_root).resolve()
        self.server_instance = uuid.uuid4().hex
        self.tmux_session_name = _resolve_tmux_session_name_impl(self) or ""
        self.session_is_active = bool(self.tmux_session_name)
        self._agent_running = set(initial_running_agents or [])
        self._events = threading.Condition()
        self._event_counts = dict.fromkeys(EVENT_KINDS, 0)
        self._native_log = NativeLogSyncer(
            session_binding=self._session_binding,
            workspace=self.workspace,
            mark_idle_fn=self._mark_idle,
            mark_running_from_native_activity_fn=self._mark_running_from_native_activity,
            notify_state_fn=lambda: self.publish_event("state"),
            active_agents_fn=self.active_agents,
            running_agents_fn=lambda: self._agent_running,
            pane_id_fn=self.pane_id_for_agent,
            pane_pid_fn=lambda pane_id: str(self.pane_field(pane_id, "#{pane_pid}") or "").strip(),
            session_is_active_fn=lambda: self.session_is_active,
        )
        self._native_log_bind_workers_lock = threading.Lock()
        self._native_log_bind_workers: set[str] = set()

    @property
    def session_name(self) -> str:
        return self._session_binding.session_name

    @property
    def log_path(self) -> Path:
        return self._session_binding.log_path

    @property
    def log_dir(self) -> str:
        return str(self._session_binding.session_dir)

    @property
    def session_dir(self) -> Path:
        return self._session_binding.session_dir

    def session_binding_snapshot(self) -> tuple[str, Path]:
        return self._session_binding.snapshot()

    def refresh_native_log_bindings(
        self,
        agents: list[str] | None = None,
        *,
        start_at_end: bool = False,
    ) -> None:
        replace_all = agents is None
        panes_by_agent = self.agent_panes()
        target_agents = list(agents) if agents is not None else list(panes_by_agent)
        pane_requests: list[PaneBindingRequest] = []
        for agent in target_agents:
            pane_id = panes_by_agent.get(agent, "")
            if not pane_id:
                continue
            pane_pid = self.pane_field(pane_id, "#{pane_pid}")
            pane_requests.append(
                PaneBindingRequest(
                    agent=agent,
                    pane_id=pane_id,
                    pane_pid=str(pane_pid or "").strip(),
                )
            )
        self._native_log.refresh(
            pane_requests,
            replace_all=replace_all,
            start_at_end=start_at_end,
        )

    def start_native_log_sync(self) -> None:
        if not self.session_is_active:
            return
        from native_log_sync.watch.watch_bindings import start_native_log_vnode_watcher
        self.refresh_native_log_bindings(start_at_end=True)
        start_native_log_vnode_watcher(self._native_log)

    def remove_native_log_binding(self, agent: str) -> None:
        self._native_log.remove_binding(agent)

    def append_user_entry(self, message: str, *, targets: list[str], client: str | None = None) -> dict:
        return _append_user_entry_impl(
            self,
            message,
            targets=targets,
            client=client,
        )

    def append_system_entry(self, message: str, *, agent: str = "", **extra) -> dict:
        return _append_system_entry_impl(
            self,
            message,
            agent=agent,
            extra=extra,
        )

    def adopt_commit_baseline(self) -> None:
        _adopt_commit_baseline_impl(self)

    def ensure_commit_announcements(self) -> None:
        _ensure_commit_announcements_impl(self)

    def publish_event(self, kind: str) -> None:
        with self._events:
            self._event_counts[kind] += 1
            self._events.notify_all()

    def event_counts(self) -> dict[str, int]:
        with self._events:
            return dict(self._event_counts)

    def wait_for_events(self, seen: dict[str, int], timeout: float) -> list[str]:
        with self._events:
            self._events.wait_for(lambda: self._event_counts != seen, timeout=timeout)
            changed = [kind for kind in EVENT_KINDS if self._event_counts[kind] != seen[kind]]
            seen.update(self._event_counts)
            return changed

    def session_state_payload(self) -> dict:
        return _build_session_state_payload_impl(
            self,
            server_instance=self.server_instance,
            session_name=self.session_name,
        )

    def payload(self, limit: int, offset: int) -> bytes:
        entries = newest_entries(self.log_path, offset=offset, limit=limit + 1)
        has_older = len(entries) > limit
        if has_older:
            entries = entries[1:]
        return json.dumps(
            {"server_instance": self.server_instance, "has_older": has_older, "entries": entries},
            ensure_ascii=True,
        ).encode("utf-8")

    def active_agents(self) -> list[str]:
        return list(self.agent_panes())

    def agent_panes(self) -> dict[str, str]:
        if not self.session_is_active:
            return {}
        return {
            pane.name: pane.pane_id
            for pane in _agent_topology_impl(self.tmux_session_name)
        }

    def pane_id_for_agent(self, agent_name: str) -> str:
        return self.agent_panes().get(agent_name, "")

    def pane_id_for_terminal(self) -> str:
        if not self.session_is_active:
            return ""
        return _terminal_window_pane_id_impl(self.tmux_session_name)

    def pane_id_for_control_target(self, target: str) -> str:
        return self.pane_id_for_terminal() if target == "terminal" else self.pane_id_for_agent(target)

    def pane_field(self, pane_id: str, field: str) -> str:
        return _pane_field_impl(self, pane_id, field)

    def _mark_agent_sent(self, agent_name: str) -> None:
        _mark_agent_sent_impl(self, agent_name)

    def mark_agents_running(self, agents: list[str]) -> None:
        for agent in agents:
            self._mark_running(agent)

    def mark_agents_idle(self, agents: list[str]) -> None:
        for agent in agents:
            self._agent_running.discard(agent)
            self._native_log.clear_agent_runtime_display(agent)
        self.publish_event("state")

    def running_agents_for_reload(self) -> list[str]:
        return sorted(self._agent_running)

    def _mark_running(self, agent: str) -> None:
        already_running = agent in self._agent_running
        if not already_running:
            self._native_log.clear_agent_runtime_display(agent)
        self._agent_running.add(agent)
        if not already_running:
            self.publish_event("state")

    def _bind_native_log_after_send(self, agent: str) -> None:
        with self._native_log_bind_workers_lock:
            if agent in self._native_log_bind_workers:
                return
            self._native_log_bind_workers.add(agent)

        def bind() -> None:
            deadline = time.monotonic() + NATIVE_LOG_BIND_TIMEOUT_SECONDS
            try:
                while agent in self.active_agents():
                    try:
                        self.refresh_native_log_bindings([agent], start_at_end=True)
                    except Exception:
                        logging.exception("native log bind failed for %s", agent)
                        return
                    if self._native_log.has_log_binding(agent):
                        return
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        logging.error(
                            "native log did not appear within %.1fs for %s",
                            NATIVE_LOG_BIND_TIMEOUT_SECONDS,
                            agent,
                        )
                        return
                    time.sleep(min(NATIVE_LOG_BIND_INTERVAL_SECONDS, remaining))
            finally:
                with self._native_log_bind_workers_lock:
                    self._native_log_bind_workers.discard(agent)

        threading.Thread(
            target=bind,
            daemon=True,
            name=f"native-bind-{agent}",
        ).start()

    def _mark_running_from_native_activity(self, agent: str) -> None:
        if agent in self._agent_running:
            return
        self._agent_running.add(agent)
        self.publish_event("state")

    def _mark_idle(self, agent: str) -> None:
        was_running = agent in self._agent_running
        self._agent_running.discard(agent)
        cleared = self._native_log.clear_agent_runtime_display(agent)
        if was_running or cleared:
            self.publish_event("state")

    @staticmethod
    def resolve_agent_executable(agent_name: str) -> str:
        return _resolve_agent_executable_impl(agent_name)

    def restart_agent_pane(self, agent_name: str) -> tuple[bool, str]:
        return _restart_agent_pane_impl(self, agent_name)

    def deliver_message(self, targets: list[str], message: str) -> list[str]:
        return _deliver_message_impl(self, targets, message)

    def agent_statuses(self) -> dict[str, str]:
        return self._native_log.agent_statuses(self._agent_running)

    def agent_runtime_state(self) -> dict[str, dict]:
        return self._native_log.agent_runtime_state()

    def native_log_watched_paths(self) -> dict[str, str]:
        return self._native_log.watched_paths()

    def trace_content(self, agent: str, *, tail_lines: int) -> str:
        pane_id = self.pane_id_for_control_target(agent)
        if not pane_id:
            return "Offline"
        return _trace_content_impl(self, pane_id, tail_lines=tail_lines)
