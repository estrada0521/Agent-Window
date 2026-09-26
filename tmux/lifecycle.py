from __future__ import annotations

import os
import subprocess

from tmux import TMUX
from tmux.process_cleanup import cleanup_target_process_groups


def respawn_pane(pane_id: str, *, workspace: str, command: str, title: str) -> tuple[bool, str]:
    shell = os.environ.get("SHELL") or "/bin/zsh"
    cleanup_target_process_groups(target=pane_id)
    respawn_res = subprocess.run(
        [
            *TMUX,
            "respawn-pane",
            "-k",
            "-t",
            pane_id,
            "-c",
            workspace,
            shell,
            "-lc",
            command,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if respawn_res.returncode != 0:
        return False, (respawn_res.stderr or respawn_res.stdout or "").strip()
    subprocess.run(
        [*TMUX, "select-pane", "-t", pane_id, "-T", title],
        capture_output=True,
        check=False,
    )
    return True, ""
