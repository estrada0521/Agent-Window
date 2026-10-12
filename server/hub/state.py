from __future__ import annotations

import subprocess
import sys
import threading
import uuid
import time
from dataclasses import dataclass

from tmux import run_tmux
from fs.log.paths import normalize_workspace
from server.timeline.state import TimelineState
from server.timeline.assets import TimelineAssets
from server.hub.timeline_query import live_timelines_query


@dataclass(frozen=True)
class TmuxRunResult:
    args: list[str]
    returncode: int
    stdout: str = ""
    stderr: str = ""
    timed_out: bool = False


class HubState:
    def __init__(self, *, initial_running_agents: dict | None = None):
        self.server_instance = uuid.uuid4().hex
        self.assets = TimelineAssets()
        self._timelines = {}
        self._timeline_locks = {}
        self._timeline_locks_master = threading.Lock()
        self._initial_running_agents = initial_running_agents or {}
        self._closed = False
        self._timeline_messages_condition = threading.Condition()
        self._timeline_messages_seq = 0

    def _get_timeline_lock(self, workspace: str):
        key = normalize_workspace(workspace)
        with self._timeline_locks_master:
            if key not in self._timeline_locks:
                self._timeline_locks[key] = threading.RLock()
            return self._timeline_locks[key]

    def timeline(self, workspace: str) -> TimelineState:
        workspace = normalize_workspace(workspace)
        with self._get_timeline_lock(workspace):
            if self._closed:
                raise RuntimeError("Hub is restarting")
            state = self._timelines.get(workspace)
            if state is None:
                state = TimelineState(
                    workspace=workspace,
                    server_instance=self.server_instance,
                    publish_hub_messages=self.publish_timeline_messages_changed,
                    initial_running_agents=self._initial_running_agents.pop(workspace, []),
                )
                with self._timeline_locks_master:
                    if self._closed:
                        state.close()
                        raise RuntimeError("Hub is restarting")
                    self._timelines[workspace] = state
                if state.session_is_active:
                    state.start()
            return state

    def start_timelines(self) -> None:
        live = live_timelines_query(self)
        if live.state == "unhealthy":
            print(live.detail, file=sys.stderr, flush=True)
            return
        for workspace in live.workspaces.values():
            try:
                self.timeline(workspace)
            except Exception as exc:
                print(f"Timeline startup failed: {workspace}: {exc}", file=sys.stderr, flush=True)

    def watch_timeline(self, state: TimelineState) -> None:
        with self._get_timeline_lock(state.workspace):
            if state.closed:
                raise RuntimeError("Timeline is closed")
            state.start()
            state.viewers += 1

    def release_timeline(self, state: TimelineState) -> None:
        with self._get_timeline_lock(state.workspace):
            state.viewers -= 1
            if not state.session_is_active and state.viewers == 0 and self._timelines.get(state.workspace) is state:
                self.close_timeline(state.workspace)

    def close_timeline(self, workspace: str) -> None:
        workspace = normalize_workspace(workspace)
        with self._get_timeline_lock(workspace):
            state = self._timelines.pop(workspace, None)
            if state:
                state.close()

    def close(self) -> None:
        with self._timeline_locks_master:
            self._closed = True
            states = list(self._timelines.values())
        for state in states:
            with self._get_timeline_lock(state.workspace):
                state.close()

    def running_agents_for_reload(self) -> dict:
        return {workspace: state.running_agents_for_reload()
                for workspace, state in self._timelines.items() if state.session_is_active}

    def publish_timeline_messages_changed(self) -> None:
        with self._timeline_messages_condition:
            self._timeline_messages_seq += 1
            self._timeline_messages_condition.notify_all()

    def wait_for_timeline_messages_changed(self, after_seq: int, timeout: float = 15.0) -> int | None:
        deadline = time.monotonic() + max(0.1, float(timeout))
        with self._timeline_messages_condition:
            while self._timeline_messages_seq <= after_seq:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._timeline_messages_condition.wait(timeout=remaining)
            return self._timeline_messages_seq

    def tmux_run(self, args, timeout=2) -> TmuxRunResult:
        try:
            res = run_tmux(args, timeout=timeout)
            return TmuxRunResult(
                args=list(args),
                returncode=res.returncode,
                stdout=res.stdout,
                stderr=res.stderr,
                timed_out=False,
            )
        except subprocess.TimeoutExpired as exc:
            return TmuxRunResult(
                args=list(args),
                returncode=124,
                stdout=exc.stdout.decode("utf-8", errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or ""),
                stderr=f"tmux command timed out after {timeout} seconds",
                timed_out=True,
            )
