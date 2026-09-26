from __future__ import annotations

import subprocess
import threading
import uuid
import time
from dataclasses import dataclass
from pathlib import Path

from tmux import TMUX
from fs.log.paths import normalize_workspace


@dataclass(frozen=True)
class TmuxRunResult:
    args: list[str]
    returncode: int
    stdout: str = ""
    stderr: str = ""
    timed_out: bool = False


class HubState:
    def __init__(self, repo_root: Path | str, hub_port: int):
        self.repo_root = Path(repo_root).resolve()
        self.hub_port = hub_port
        self.instance = uuid.uuid4().hex
        self._launch_locks = {}
        self._launch_locks_master = threading.Lock()
        self._timeline_messages_condition = threading.Condition()
        self._timeline_messages_seq = 0

    def _get_launch_lock(self, workspace: str) -> threading.Lock:
        key = normalize_workspace(workspace)
        with self._launch_locks_master:
            if key not in self._launch_locks:
                self._launch_locks[key] = threading.Lock()
            return self._launch_locks[key]

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
            res = subprocess.run(
                [*TMUX, *args],
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
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
