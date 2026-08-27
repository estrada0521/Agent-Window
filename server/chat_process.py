from __future__ import annotations

import subprocess
import sys
import time
from collections.abc import Callable, Mapping
from pathlib import Path


CHAT_SERVER_READY_TIMEOUT_SEC = 6.0


def launch_chat_server(workspace: Path | str, *, env: Mapping[str, str]) -> subprocess.Popen:
    raw_workspace = str(workspace or "").strip()
    if not raw_workspace:
        raise ValueError("workspace is required")
    workspace_path = Path(raw_workspace).expanduser().resolve()
    resolved_workspace = str(workspace_path)
    repo_root = Path(__file__).resolve().parent.parent
    return subprocess.Popen(
        [sys.executable, "-m", "server.server", resolved_workspace],
        cwd=str(repo_root),
        env=dict(env),
        start_new_session=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def wait_for_chat_server(
    process: subprocess.Popen,
    ready: Callable[[], bool],
    *,
    timeout_sec: float = CHAT_SERVER_READY_TIMEOUT_SEC,
) -> bool:
    deadline = time.monotonic() + timeout_sec
    while True:
        if ready():
            return True
        if process.poll() is not None:
            return False
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        time.sleep(min(0.1, remaining))
