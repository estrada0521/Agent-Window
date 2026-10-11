from __future__ import annotations

import subprocess

TMUX_SOCKET_NAME = "agent-window"
TMUX = ("tmux", "-L", TMUX_SOCKET_NAME)


def run_tmux(args: list[str], *, timeout: float | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run([*TMUX, *args], capture_output=True, text=True, timeout=timeout, check=False)
