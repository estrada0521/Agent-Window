from __future__ import annotations

import subprocess
import sys
import time
from collections.abc import Callable, Mapping
from pathlib import Path


TIMELINE_SERVER_READY_TIMEOUT_SEC = 6.0


def launch_timeline_server(workspace: Path | str, *, env: Mapping[str, str]) -> subprocess.Popen:
    return subprocess.Popen(
        [sys.executable, "-m", "server.timeline.server", str(Path(workspace).expanduser().resolve())],
        cwd=str(Path(__file__).resolve().parents[2]),
        env=dict(env),
        start_new_session=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def wait_for_timeline_server(
    process: subprocess.Popen,
    ready: Callable[[], bool],
    *,
    timeout_sec: float = TIMELINE_SERVER_READY_TIMEOUT_SEC,
) -> str:
    deadline = time.monotonic() + timeout_sec
    while not ready():
        code = process.poll()
        if code is not None:
            return f"timeline server exited with code {code} before becoming ready"
        if time.monotonic() >= deadline:
            process.kill()
            process.wait()
            return f"timeline server did not become ready within {timeout_sec:g}s"
        time.sleep(0.1)
    return ""
