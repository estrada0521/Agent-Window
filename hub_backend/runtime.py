from __future__ import annotations

import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path

from backend_core.access.settings import pwa_https_enabled
from backend_core.tmux.window import tmux_prefix_args
from backend_core.tmux.resolve import normalize_workspace


@dataclass(frozen=True)
class TmuxRunResult:
    args: list[str]
    returncode: int
    stdout: str = ""
    stderr: str = ""
    timed_out: bool = False


class HubRuntime:
    def __init__(self, repo_root: Path | str, tmux_socket: str = "", hub_port: int = 0):
        self.repo_root = Path(repo_root).resolve()
        self.tmux_socket = tmux_socket
        self.hub_port = int(hub_port or 0)
        self.hub_scheme = "https" if pwa_https_enabled() else "http"
        self.tmux_prefix = tmux_prefix_args(tmux_socket) if tmux_socket else ["tmux"]
        self._launch_locks = {}
        self._launch_locks_master = threading.Lock()

    def _get_launch_lock(self, workspace: str) -> threading.Lock:
        key = normalize_workspace(workspace)
        with self._launch_locks_master:
            if key not in self._launch_locks:
                self._launch_locks[key] = threading.Lock()
            return self._launch_locks[key]

    def tmux_run(self, args, timeout=2) -> TmuxRunResult:
        try:
            res = subprocess.run(
                [*self.tmux_prefix, *args],
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

    def tmux_env_query(self, session_name: str, key: str) -> tuple[str, bool]:
        result = self.tmux_run(["show-environment", "-t", session_name, key])
        line = result.stdout.strip()
        if result.returncode == 0 and "=" in line:
            return line.split("=", 1)[1], result.timed_out
        return "", result.timed_out
