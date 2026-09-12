from __future__ import annotations
import logging

import subprocess
import threading
import time
import uuid
from collections import deque
from datetime import datetime as dt_datetime
from pathlib import Path

from backend_core.agents.executables import (
    agent_launch_cmd as _agent_launch_cmd_impl,
    agent_resume_cmd as _agent_resume_cmd_impl,
    resolve_agent_executable_for_runtime as _resolve_agent_executable_impl,
)
from backend_core.tmux.lifecycle import (
    restart_agent_pane as _restart_agent_pane_impl,
    resume_agent_pane as _resume_agent_pane_impl,
)
from message_delivery import (
    mark_agent_sent as _mark_agent_sent_impl,
    send_message as _send_message_impl,
)
from .entry_write import (
    append_system_entry as _append_system_entry_impl,
    append_user_entry as _append_user_entry_impl,
)
from .index_cache import MATCHED_ENTRY_TAIL, message_entry_window
from workspace_sync.commit import (
    adopt_commit_baseline as _adopt_commit_baseline_impl,
    ensure_commit_announcements as _ensure_commit_announcements_impl,
)
from .payload import (
    build_payload_document,
    encode_payload_document,
)
from native_log_sync.syncer import NativeLogSyncer
from native_log_sync.refresh.binding_models import PaneBindingRequest
from backend_core.tmux.session import (
    agent_topology as _agent_topology_impl,
    pane_field as _pane_field_impl,
    resolve_tmux_session_name as _resolve_tmux_session_name_impl,
)
from .session_state import (
    build_session_state_payload as _build_session_state_payload_impl,
    initialize_session_state_bus as _initialize_session_state_bus_impl,
    publish_session_state_change as _publish_session_state_change_impl,
    wait_for_session_state_change as _wait_for_session_state_change_impl,
)
from pane_trace import trace_content as _trace_content_impl
from backend_core.tmux.instances import resolve_target_agents as resolve_target_agent_names
from backend_core.tmux.window import tmux_prefix_args
from backend_core.access.files import append_jsonl_entry
from .session_binding import WorkspaceSessionBinding


ENTRY_WINDOW_LIMIT = 2000
NATIVE_LOG_BIND_INTERVAL_SECONDS = 0.5
NATIVE_LOG_BIND_TIMEOUT_SECONDS = 3.0


class ChatRuntime:
    def __init__(
        self,
        *,
        port: int,
        workspace: str,
        tmux_socket: str,
        hub_port: int,
        repo_root: Path | str,
        initial_running_agents: list[str] | None = None,
    ):
        self._session_binding = WorkspaceSessionBinding(workspace)
        self.port = int(port)
        self.workspace = self._session_binding.workspace
        self.tmux_socket = tmux_socket
        self.hub_port = int(hub_port)
        self.repo_root = Path(repo_root).resolve()
        self.server_instance = uuid.uuid4().hex
        self.tmux_prefix = tmux_prefix_args(self.tmux_socket) if self.tmux_socket else ["tmux"]
        # The AW label may change independently, so bind this process to the
        # live tmux session by its native session working directory.
        self.tmux_session_name = _resolve_tmux_session_name_impl(self) or ""
        self.session_is_active = bool(self.tmux_session_name)
        self._agent_running = set(initial_running_agents or [])
        _initialize_session_state_bus_impl(self)
        self._native_log = NativeLogSyncer(
            session_binding=self._session_binding,
            workspace=self.workspace,
            mark_idle_fn=self._mark_idle,
            mark_running_from_native_activity_fn=self._mark_running_from_native_activity,
            notify_state_fn=self.notify_session_state_changed,
            active_agents_fn=self.active_agents,
            running_agents_fn=lambda: self._agent_running,
            pane_id_fn=self.pane_id_for_agent,
            session_is_active_fn=lambda: self.session_is_active,
        )
        self._native_log_bind_workers_lock = threading.Lock()
        self._native_log_bind_workers: set[str] = set()
        self._payload_cache_lock = threading.Lock()
        self._payload_cache: dict[tuple, bytes] = {}
        self._payload_cache_order: deque[tuple] = deque(maxlen=8)
        self._matched_entries_cache_lock = threading.Lock()
        self._matched_entries_cache_sig: tuple[int, int] = (0, 0)
        self._matched_entries_cache_size = 0
        self._matched_entries_cache_entries: deque[dict] = deque(maxlen=MATCHED_ENTRY_TAIL)
        self._matched_entries_total = 0

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

    def invalidate_payload_cache(self) -> None:
        with self._payload_cache_lock:
            self._payload_cache.clear()
            self._payload_cache_order.clear()

    def remove_native_log_binding(self, agent: str) -> None:
        self._native_log.remove_binding(agent)

    def append_user_entry(self, message: str, *, targets: list[str], client: str | None = None) -> dict:
        return _append_user_entry_impl(
            self,
            message,
            targets=targets,
            datetime_class=dt_datetime,
            append_jsonl_entry_fn=append_jsonl_entry,
            client=client,
        )

    def append_system_entry(self, message: str, *, agent: str = "", **extra) -> dict:
        return _append_system_entry_impl(
            self,
            message,
            agent=agent,
            extra=extra,
            datetime_class=dt_datetime,
            append_jsonl_entry_fn=append_jsonl_entry,
        )

    def adopt_commit_baseline(self) -> None:
        _adopt_commit_baseline_impl(self)

    def ensure_commit_announcements(self) -> None:
        _ensure_commit_announcements_impl(self)

    def _entry_window(
        self,
        *,
        limit_override: int | None = None,
        offset: int = 0,
    ) -> tuple[list[dict], bool, int]:
        return message_entry_window(
            self,
            limit_override=limit_override,
            default_limit=ENTRY_WINDOW_LIMIT,
            offset=offset,
        )

    def notify_session_state_changed(
        self,
        projections: str | list[str] | tuple[str, ...] | set[str] | None = None,
        *,
        reason: str = "",
    ) -> None:
        _publish_session_state_change_impl(self, projections, reason=reason)

    def wait_for_session_state_change(self, after_seq: int, timeout: float = 15.0) -> dict | None:
        return _wait_for_session_state_change_impl(self, after_seq, timeout=timeout)

    def session_state_payload(
        self,
        projections: str | list[str] | tuple[str, ...] | set[str] | None = None,
    ) -> dict:
        return _build_session_state_payload_impl(
            self,
            server_instance=self.server_instance,
            session_name=self.session_name,
            projections=projections,
        )

    def payload(
        self,
        limit_override: int | None = None,
        offset: int = 0,
    ) -> bytes:
        try:
            stat = self.log_path.stat()
            index_sig = (stat.st_size, stat.st_mtime_ns)
        except OSError:
            index_sig = (0, 0)
        cache_key = (
            self.session_name,
            index_sig,
            limit_override,
            offset,
            bool(self.session_is_active),
        )
        with self._payload_cache_lock:
            cached = self._payload_cache.get(cache_key)
            if cached is not None:
                return cached
        entries, has_older, _total_count = self._entry_window(
            limit_override=limit_override,
            offset=offset,
        )
        payload_doc = build_payload_document(
            server_instance=self.server_instance,
            has_older=has_older,
            entries=entries,
        )
        body = encode_payload_document(payload_doc)
        with self._payload_cache_lock:
            if cache_key not in self._payload_cache:
                self._payload_cache_order.append(cache_key)
            self._payload_cache[cache_key] = body
            while len(self._payload_cache) > self._payload_cache_order.maxlen:
                old_key = self._payload_cache_order.popleft()
                self._payload_cache.pop(old_key, None)
        return body


    def active_agents(self) -> list[str]:
        return list(self.agent_panes())

    def agent_panes(self) -> dict[str, str]:
        if not self.session_is_active:
            return {}
        return {
            pane.name: pane.pane_id
            for pane in _agent_topology_impl(
                self.tmux_prefix,
                self.tmux_session_name,
                subprocess_module=subprocess,
            )
        }

    def resolve_target_agents(self, target: str) -> list[str]:
        return resolve_target_agent_names(target, self.active_agents())

    def pane_id_for_agent(self, agent_name: str) -> str:
        return self.agent_panes().get(agent_name, "")

    def pane_field(self, pane_id: str, field: str) -> str:
        return _pane_field_impl(self, pane_id, field, subprocess_module=subprocess)

    def _mark_agent_sent(self, agent_name: str) -> None:
        _mark_agent_sent_impl(self, agent_name)

    def mark_agents_running(self, agents: list[str]) -> None:
        for agent in agents:
            self._mark_running(agent)

    def running_agents_for_reload(self) -> list[str]:
        return sorted(self._agent_running)

    def _mark_running(self, agent: str) -> None:
        already_running = agent in self._agent_running
        if not already_running:
            self._native_log.clear_agent_runtime_display(agent)
        self._agent_running.add(agent)
        if not already_running:
            self.notify_session_state_changed(["statuses", "agent_runtime"], reason="agent-status")

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
                        # A binding that only just appeared has no backlog to
                        # project -- follow it from EOF, like start_native_log_sync.
                        # Without this, a resumed CLI's whole history replays in.
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
        """Mark an idle agent running without rebinding its already-watched log."""
        if agent in self._agent_running:
            return
        self._agent_running.add(agent)
        self.notify_session_state_changed(["statuses"], reason="agent-native-activity")

    def _mark_idle(self, agent: str) -> None:
        was_running = agent in self._agent_running
        self._agent_running.discard(agent)
        cleared = self._native_log.clear_agent_runtime_display(agent)
        if was_running:
            self.notify_session_state_changed(["statuses", "agent_runtime"], reason="agent-status")
        elif cleared:
            self.notify_session_state_changed(["agent_runtime"], reason="agent-runtime-clear")

    def agent_launch_cmd(self, agent_name: str) -> str:
        return _agent_launch_cmd_impl(self, agent_name)

    def agent_resume_cmd(self, agent_name: str) -> str:
        return _agent_resume_cmd_impl(self, agent_name)

    @staticmethod
    def resolve_agent_executable(agent_name: str) -> str:
        return _resolve_agent_executable_impl(agent_name)

    def restart_agent_pane(self, agent_name: str) -> tuple[bool, str]:
        return _restart_agent_pane_impl(self, agent_name)

    def resume_agent_pane(self, agent_name: str) -> tuple[bool, str]:
        return _resume_agent_pane_impl(self, agent_name)

    def send_message(
        self,
        target: str,
        message: str,
        append_entry: bool = True,
        client: str | None = None,
    ) -> tuple[int, dict]:
        return _send_message_impl(
            self,
            target,
            message,
            append_entry=append_entry,
            client=client,
        )

    def agent_statuses(self) -> dict[str, str]:
        return self._native_log.agent_statuses(self._agent_running)

    def agent_runtime_state(self) -> dict[str, dict]:
        return self._native_log.agent_runtime_state()

    def native_log_watched_paths(self) -> dict[str, str]:
        return self._native_log.watched_paths()

    def trace_content(self, agent: str, *, tail_lines: int) -> str:
        pane_id = self.pane_id_for_agent(agent)
        if not pane_id:
            return "Offline"
        return _trace_content_impl(self, pane_id, tail_lines=tail_lines)
