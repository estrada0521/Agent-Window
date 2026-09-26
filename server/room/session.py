from __future__ import annotations
import json
import os
import subprocess
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from fs.session.log import append_jsonl_entry
from fs.session.meta import session_meta_agents
from tmux import TMUX
from tmux.send_keys import deliver_text_to_pane
from fs.session.log import newest_entries
from agents.dispatch import sync_agent
from agents.binding_models import PaneBindingRequest
from agents.refresh_bindings import refresh_native_log_bindings, remove_native_log_binding
from agents.emit_events import (
    clear_agent_running_display,
    idle_running_display_for_api,
    refresh_idle_statuses,
)
from agents.watch_bindings import start_native_log_vnode_watcher
from tmux.session import (
    agent_topology,
    find_session_for_workspace,
    pane_field,
    terminal_window_pane_id,
)
from tmux.capture_pane import trace_content
from server.room.session_binding import WorkspaceSessionBinding


ENTRY_WINDOW_LIMIT = 2000
EVENT_KINDS = ("messages", "state", "files", "git", "failure")
NATIVE_LOG_BIND_INTERVAL_SECONDS = 0.5
NATIVE_LOG_BIND_TIMEOUT_SECONDS = 3.0


class RoomSession:
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
        self.tmux_session_name = find_session_for_workspace(self.workspace) or ""
        self.session_is_active = bool(self.tmux_session_name)
        self._agent_running = set(initial_running_agents or [])
        self._last_announced_commit_hash: str | None = None
        self._events = threading.Condition()
        self._event_counts = dict.fromkeys(EVENT_KINDS, 0)
        self._latest_failure = ""
        self._native_log_read_offsets: dict[str, int] = {}
        self._native_log_bindings_by_agent: dict = {}
        self._native_log_bindings_lock = threading.Lock()
        self._native_log_sync_lock = threading.Lock()
        self._native_log_vnode_watcher = None
        self._idle_running_display_by_agent: dict[str, dict] = {}
        self._idle_running_event_seq = 0
        self._idle_running_display_lock = threading.Lock()
        self._idle_running_display_queues: dict = {}
        self._idle_running_display_timers: dict = {}
        self._native_log_bind_workers_lock = threading.Lock()
        self._native_log_bind_workers: set[str] = set()

    @property
    def session_name(self) -> str:
        return self._session_binding.session_name

    @property
    def log_path(self) -> Path:
        return self._session_binding.log_path

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
            pane_requests.append(
                PaneBindingRequest(agent=agent, pane_id=pane_id, pane_pid=pane_field(pane_id, "#{pane_pid}"))
            )
        for binding in refresh_native_log_bindings(self, pane_requests, replace_all=replace_all):
            try:
                sync_agent(self, binding.agent, binding.path, start_at_end=start_at_end)
            except Exception as exc:
                self.native_log_failed(binding.agent, f"sync failed: {exc}")

    def native_log_failed(self, agent: str, detail: str) -> None:
        self.remove_native_log_binding(agent)
        self._mark_idle(agent)
        self.report_failure(f"native log failed: {agent}: {detail}")

    def rebind(self, agent: str) -> None:
        if self.pane_id_for_agent(agent):
            self.refresh_native_log_bindings([agent], start_at_end=True)
        else:
            self.remove_native_log_binding(agent)

    def start_native_log_sync(self) -> None:
        if not self.session_is_active:
            return
        self.refresh_native_log_bindings(start_at_end=True)
        start_native_log_vnode_watcher(self)

    def remove_native_log_binding(self, agent: str) -> None:
        remove_native_log_binding(self, agent)

    def _append_entry(self, entry: dict) -> dict:
        return append_jsonl_entry(
            self.log_path,
            {"timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "session": self.session_name, **entry},
        )

    def append_user_entry(self, message: str, *, targets: list[str], client: str | None = None) -> dict:
        entry = {"sender": "user", "targets": list(targets), "message": message}
        if client in ("desktop", "mobile"):
            entry["client"] = client
        return self._append_entry(entry)

    def append_system_entry(self, message: str, *, agent: str = "", **extra) -> dict:
        entry = {"sender": "system", "targets": [], "message": message}
        if agent:
            entry["agent"] = agent
        return self._append_entry({**entry, **extra})

    def publish_event(self, kind: str) -> None:
        with self._events:
            self._event_counts[kind] += 1
            self._events.notify_all()

    def event_counts(self) -> dict[str, int]:
        with self._events:
            return dict(self._event_counts)

    def report_failure(self, text: str) -> None:
        with self._events:
            self._latest_failure = text
            self._event_counts["failure"] += 1
            self._events.notify_all()

    def wait_for_events(self, seen: dict[str, int], timeout: float) -> list[tuple[str, str]]:
        with self._events:
            self._events.wait_for(lambda: self._event_counts != seen, timeout=timeout)
            changed = [
                (kind, self._latest_failure if kind == "failure" else "")
                for kind in EVENT_KINDS
                if self._event_counts[kind] != seen[kind]
            ]
            seen.update(self._event_counts)
            return changed

    def session_state_payload(self) -> dict:
        session_name = self.session_name
        return {
            "server_instance": self.server_instance,
            "pid": os.getpid(),
            "session": session_name,
            "active": self.session_is_active,
            "workspace": self.workspace,
            "repo_root": str(self.repo_root),
            "targets": self.active_agents() if self.session_is_active else session_meta_agents(session_name),
            "statuses": self.agent_statuses(),
            "running_display": self.running_display_state(),
        }

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
            for pane in agent_topology(self.tmux_session_name)
        }

    def pane_id_for_agent(self, agent_name: str) -> str:
        return self.agent_panes().get(agent_name, "")

    def pane_id_for_terminal(self) -> str:
        if not self.session_is_active:
            return ""
        return terminal_window_pane_id(self.tmux_session_name)

    def pane_id_for_control_target(self, target: str) -> str:
        return self.pane_id_for_terminal() if target == "terminal" else self.pane_id_for_agent(target)

    def mark_agents_running(self, agents: list[str]) -> None:
        for agent in agents:
            self._mark_running(agent)

    def mark_agents_idle(self, agents: list[str]) -> None:
        for agent in agents:
            self._agent_running.discard(agent)
            clear_agent_running_display(self, agent)
        self.publish_event("state")

    def running_agents_for_reload(self) -> list[str]:
        return sorted(self._agent_running)

    def _mark_running(self, agent: str) -> None:
        already_running = agent in self._agent_running
        if not already_running:
            clear_agent_running_display(self, agent)
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
                    except Exception as exc:
                        self.native_log_failed(agent, f"bind failed: {exc}")
                        return
                    if agent in self._native_log_bindings_by_agent:
                        return
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        self.native_log_failed(
                            agent,
                            f"no native log appeared within {NATIVE_LOG_BIND_TIMEOUT_SECONDS:g}s of sending",
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
        cleared = clear_agent_running_display(self, agent)
        if was_running or cleared:
            self.publish_event("state")

    def deliver_message(self, targets: list[str], message: str) -> list[str]:
        panes_by_agent = self.agent_panes()

        def run_tmux(args):
            return subprocess.run([*TMUX, *args], capture_output=True, text=True, check=False)

        failed: list[str] = []
        for agent in targets:
            pane_id = panes_by_agent.get(agent, "")
            if not pane_id or not deliver_text_to_pane(run_tmux, pane_id, message):
                failed.append(agent)
                continue
            self._mark_running(agent)
            self._bind_native_log_after_send(agent)
        return failed

    def agent_statuses(self) -> dict[str, str]:
        return refresh_idle_statuses(self, self._agent_running)

    def running_display_state(self) -> dict[str, dict]:
        return idle_running_display_for_api(self._idle_running_display_by_agent)

    def native_log_watched_paths(self) -> dict[str, str]:
        watcher = self._native_log_vnode_watcher
        return watcher.get_watched_paths() if watcher else {}

    def trace_content(self, agent: str, *, tail_lines: int) -> str:
        pane_id = self.pane_id_for_control_target(agent)
        if not pane_id:
            return "Offline"
        return trace_content(pane_id, tail_lines=tail_lines)
