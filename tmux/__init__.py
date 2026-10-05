from __future__ import annotations

import subprocess
from collections.abc import Mapping

TMUX_SOCKET_NAME = "agent-window"
TMUX = ("tmux", "-L", TMUX_SOCKET_NAME)


def run_tmux(
    args: list[str],
    *,
    timeout: float | None = None,
    socket_path: str | None = None,
    env: Mapping[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    command = ("tmux", "-S", socket_path) if socket_path is not None else TMUX
    return subprocess.run(
        [*command, *args], capture_output=True, text=True,
        timeout=timeout, env=env, check=False,
    )
