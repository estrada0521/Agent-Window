from __future__ import annotations
import json
import os
import queue
import select
import threading
from datetime import datetime
from pathlib import Path

from fs.log.jsonl import append_jsonl_entry, message_window
from fs.log.meta import log_meta_agents
from fs.files.workspace import WorkspaceFiles
from fs.watch import start_workspace_fsevents_watcher
from tmux import run_tmux
from tmux.send_keys import deliver_text_to_pane
from agents.native_log_projector import NativeLogProjector
from git.commit import CommitAnnouncer
from tmux.session import (
    agent_topology,
    find_session_for_workspace,
    terminal_window_pane_id,
)
from tmux.capture_pane import trace_content
from server.timeline.binding import WorkspaceTimelineBinding


ENTRY_WINDOW_LIMIT = 2000
EVENT_KINDS = ("messages", "state", "files", "failure")


class TimelineState:
    def __init__(
        self,
        *,
        workspace: str,
        server_instance: str,
        publish_hub_messages,
    ):
        self._timeline_binding = WorkspaceTimelineBinding(workspace)
        self.workspace = self._timeline_binding.workspace
        self.server_instance = server_instance
        self._publish_hub_messages = publish_hub_messages
        self.tmux_session_name = find_session_for_workspace(self.workspace) or ""
        self.session_is_active = bool(self.tmux_session_name)
        self._agent_running = set()
        self._events = threading.Condition()
        self._event_counts = dict.fromkeys(EVENT_KINDS, 0)
        self._event_data: dict[str, str] = {}
        self._latest_failure = ""
        self._stopped_threads: dict[str, str] = {}
        self.files = WorkspaceFiles(workspace=self.workspace)
        self.requests = 0
        self.closed = False
        self._log_thread = self._send_thread = None
        self._watch_stop = None
        self._log_stop_r = self._log_stop_w = None
        self.send_queue = queue.Queue()
        self.native_log = NativeLogProjector(
            workspace=self.workspace,
            log_path=lambda: self.log_path,
            agent_panes=self.agent_panes,
            publish_state=lambda: self.publish_event("state"),
            report_failure=self.report_failure,
            mark_idle=self._mark_idle,
            mark_running=self._mark_running_from_native_activity,
        )
        self.commits = CommitAnnouncer(self.workspace, self._announce_commit)

    def start(self) -> None:
        if self._log_thread:
            return
        try:
            self.commits.adopt_baseline()
        except Exception as exc:
            self.report_failure(f"Commit tracking failed: {exc}")
        try:
            self._watch_stop = start_workspace_fsevents_watcher(
                self.files, publish_event=self.publish_event,
                report_failure=self.report_failure, on_head_changed=self.commits.observe,
            )
        except Exception as exc:
            self.report_thread_stopped("workspace-watch", str(exc))
        try:
            if self.session_is_active:
                self.native_log.start()
        except Exception as exc:
            self.report_thread_stopped("native-log", str(exc))
        self._log_stop_r, self._log_stop_w = os.pipe()
        def start_thread(target):
            def run():
                try:
                    target()
                except Exception as exc:
                    self.report_thread_stopped(target.__name__, str(exc))
            thread = threading.Thread(target=run, daemon=True, name=target.__name__)
            thread.start()
            return thread
        self._log_thread = start_thread(self._log_watcher)
        if self.session_is_active:
            self._send_thread = start_thread(self._queued_send_worker)

    def close(self) -> None:
        with self._events:
            if self.closed:
                return
            self.closed = True
            self._events.notify_all()
        if self._send_thread:
            self.send_queue.put(None)
            self._send_thread.join()
        self.native_log.stop()
        if self._watch_stop:
            self._watch_stop()
        if self._log_thread:
            os.write(self._log_stop_w, b"\0")
            self._log_thread.join()
            os.close(self._log_stop_r)
            os.close(self._log_stop_w)

    def _log_watcher(self) -> None:
        while not self.closed:
            fd = os.open(self.log_path, os.O_RDONLY)
            kq = select.kqueue()
            try:
                kq.control([
                    select.kevent(self._log_stop_r, filter=select.KQ_FILTER_READ, flags=select.KQ_EV_ADD),
                    select.kevent(fd, filter=select.KQ_FILTER_VNODE,
                        flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR,
                        fflags=select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND | select.KQ_NOTE_RENAME | select.KQ_NOTE_DELETE),
                ], 0)
                while not self.closed:
                    events = kq.control(None, 4, None)
                    if any(event.ident == self._log_stop_r for event in events):
                        return
                    if any(event.fflags & (select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND) for event in events):
                        self.publish_event("messages")
                        self._publish_hub_messages()
                    if any(event.fflags & (select.KQ_NOTE_RENAME | select.KQ_NOTE_DELETE) for event in events):
                        break
            finally:
                kq.close()
                os.close(fd)

    def _queued_send_worker(self) -> None:
        while True:
            job = self.send_queue.get()
            try:
                if job is None:
                    return
                failed = self.deliver_message(job["targets"], job["message"])
                if failed:
                    self.mark_agents_idle(list(failed))
                    self.publish_event("hud-error", "; ".join(f"{agent}: {error}" for agent, error in failed.items()))
            except Exception as exc:
                self.mark_agents_idle(job["targets"])
                self.publish_event("hud-error", f"Send failed: {exc}")
            finally:
                self.send_queue.task_done()

    def send_message(self, target: str, message: str, client: str | None = None) -> tuple[int, dict]:
        with self._events:
            if self.closed or not self.session_is_active:
                return 409, {"ok": False, "error": "Timeline is not active"}
            message = str(message or "")
            if not message.strip():
                return 400, {"ok": False, "error": "message is required"}
            targets = [item.strip() for item in str(target or "").split(",") if item.strip()]
            entry = self.append_user_entry(message, targets=targets or ["user"], client=client)
            if not targets:
                return 200, {"ok": True, "mode": "note", "entry": entry}
            self.send_queue.put({"targets": targets, "message": message})
            return 200, {"ok": True, "entry": entry}

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

    def publish_event(self, kind: str, data: str = "") -> None:
        with self._events:
            self._event_data[kind] = data
            self._event_counts[kind] = self._event_counts.get(kind, 0) + 1
            self._events.notify_all()

    def last_changed_git_tree(self) -> str | None:
        with self._events:
            return self._event_data.get("git-follow")

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
            self._events.wait_for(lambda: self.closed or self._event_counts != seen, timeout=timeout)
            changed = [
                (kind, self._latest_failure if kind == "failure" else self._event_data.get(kind, ""))
                for kind in self._event_counts
                if self._event_counts[kind] != seen.get(kind, 0)
            ]
            seen.update(self._event_counts)
            return changed

    def timeline_state_payload(self) -> dict:
        timeline_name = self.timeline_name
        with self._events:
            stopped_threads = [f"{name} stopped: {detail}" for name, detail in self._stopped_threads.items()]
        panes = self.agent_panes()
        return {
            "server_instance": self.server_instance,
            "timeline": timeline_name,
            "active": self.session_is_active,
            "workspace": self.workspace,
            "targets": list(panes) if self.session_is_active else log_meta_agents(timeline_name),
            "statuses": {agent: "running" if agent in self._agent_running else "idle" for agent in panes},
            "running_display": self.native_log.running_display_for_api(),
            "stopped_threads": stopped_threads,
            "failure": self._latest_failure,
        }

    def payload(self, limit: int) -> bytes:
        path = self.log_path
        data = message_window(path, cursor=path.stat().st_size, limit=limit, before=True)
        data["server_instance"] = self.server_instance
        data["has_newer"] = False
        return json.dumps(data, ensure_ascii=True).encode("utf-8")

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

    def mark_agents_delivered(self, agents: list[str]) -> None:
        for agent in agents:
            self._mark_running(agent)
            self.native_log.bind_after_send(agent)

    def mark_agents_idle(self, agents: list[str]) -> None:
        for agent in agents:
            self._agent_running.discard(agent)
            self.native_log.clear_running_display(agent)
        self.publish_event("state")

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

    def deliver_message(self, targets: list[str], message: str) -> dict[str, str]:
        panes_by_agent = self.agent_panes()
        failed: dict[str, str] = {}
        for agent in targets:
            pane_id = panes_by_agent.get(agent, "")
            try:
                error = deliver_text_to_pane(run_tmux, pane_id, message)
            except Exception as exc:
                error = str(exc)
            if error:
                failed[agent] = error
                continue
            self.mark_agents_delivered([agent])
        return failed

    def trace_content(self, agent: str, *, tail_lines: int) -> str:
        pane_id = self.pane_id_for_control_target(agent)
        if not pane_id:
            return "Offline"
        return trace_content(pane_id, tail_lines=tail_lines)
