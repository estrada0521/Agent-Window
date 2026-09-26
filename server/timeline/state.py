from __future__ import annotations
import json
import os
import subprocess
import threading
import uuid
from datetime import datetime
from pathlib import Path

from fs.log.jsonl import append_jsonl_entry
from fs.log.meta import log_meta_agents
from tmux import TMUX
from tmux.send_keys import deliver_text_to_pane
from fs.log.jsonl import newest_entries
from agents.native_log_sync import NativeLogSync
from git.commit import CommitAnnouncer
from tmux.session import (
    agent_topology,
    find_session_for_workspace,
    terminal_window_pane_id,
)
from tmux.capture_pane import trace_content
from server.timeline.binding import WorkspaceTimelineBinding


ENTRY_WINDOW_LIMIT = 2000
EVENT_KINDS = ("messages", "state", "files", "git", "failure")


class TimelineState:
    def __init__(
        self,
        *,
        port: int,
        workspace: str,
        hub_port: int,
        repo_root: Path | str,
        initial_running_agents: list[str] | None = None,
    ):
        self._timeline_binding = WorkspaceTimelineBinding(workspace)
        self.port = int(port)
        self.workspace = self._timeline_binding.workspace
        self.hub_port = int(hub_port)
        self.repo_root = Path(repo_root).resolve()
        self.server_instance = uuid.uuid4().hex
        self.tmux_session_name = find_session_for_workspace(self.workspace) or ""
        self.session_is_active = bool(self.tmux_session_name)
        self._agent_running = set(initial_running_agents or [])
        self._events = threading.Condition()
        self._event_counts = dict.fromkeys(EVENT_KINDS, 0)
        self._latest_failure = ""
        self._stopped_threads: dict[str, str] = {}
        self.native_log = NativeLogSync(
            workspace=self.workspace,
            log_path=lambda: self.log_path,
            agent_panes=self.agent_panes,
            publish_state=lambda: self.publish_event("state"),
            report_failure=self.report_failure,
            mark_idle=self._mark_idle,
            mark_running=self._mark_running_from_native_activity,
        )
        self.commits = CommitAnnouncer(self.workspace, self._announce_commit)

    @property
    def timeline_name(self) -> str:
        return self._timeline_binding.timeline_name

    @property
    def log_path(self) -> Path:
        return self._timeline_binding.log_path

    @property
    def log_dir(self) -> Path:
        return self._timeline_binding.log_dir

    def timeline_binding_snapshot(self) -> tuple[str, Path]:
        return self._timeline_binding.snapshot()

    def start_native_log_sync(self) -> None:
        if self.session_is_active:
            self.native_log.start()

    def _append_entry(self, entry: dict) -> dict:
        return append_jsonl_entry(
            self.log_path,
            {"timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), **entry},
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

    def _announce_commit(self, commit: dict) -> None:
        self.append_system_entry(
            f"Commit: {commit['short']} {commit['subject']}",
            commit_hash=commit["hash"],
            commit_short=commit["short"],
        )

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

    def report_thread_stopped(self, name: str, detail: str) -> None:
        with self._events:
            self._stopped_threads[name] = detail
            self._event_counts["state"] += 1
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

    def timeline_state_payload(self) -> dict:
        timeline_name = self.timeline_name
        with self._events:
            stopped_threads = [f"{name} stopped: {detail}" for name, detail in self._stopped_threads.items()]
        return {
            "server_instance": self.server_instance,
            "pid": os.getpid(),
            "timeline": timeline_name,
            "active": self.session_is_active,
            "workspace": self.workspace,
            "repo_root": str(self.repo_root),
            "targets": self.active_agents() if self.session_is_active else log_meta_agents(timeline_name),
            "statuses": self.agent_statuses(),
            "running_display": self.native_log.running_display_for_api(),
            "stopped_threads": stopped_threads,
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
            self.native_log.clear_running_display(agent)
        self.publish_event("state")

    def running_agents_for_reload(self) -> list[str]:
        return sorted(self._agent_running)

    def _mark_running(self, agent: str) -> None:
        already_running = agent in self._agent_running
        if not already_running:
            self.native_log.clear_running_display(agent)
        self._agent_running.add(agent)
        if not already_running:
            self.publish_event("state")

    def _mark_running_from_native_activity(self, agent: str) -> None:
        if agent in self._agent_running:
            return
        self._agent_running.add(agent)
        self.publish_event("state")

    def _mark_idle(self, agent: str) -> None:
        was_running = agent in self._agent_running
        self._agent_running.discard(agent)
        cleared = self.native_log.clear_running_display(agent)
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
            self.native_log.bind_after_send(agent)
        return failed

    def agent_statuses(self) -> dict[str, str]:
        statuses: dict[str, str] = {}
        for agent in self.active_agents():
            running = agent in self._agent_running
            statuses[agent] = "running" if running else "idle"
            if not running:
                self.native_log.clear_running_display(agent)
        return statuses

    def trace_content(self, agent: str, *, tail_lines: int) -> str:
        pane_id = self.pane_id_for_control_target(agent)
        if not pane_id:
            return "Offline"
        return trace_content(pane_id, tail_lines=tail_lines)
