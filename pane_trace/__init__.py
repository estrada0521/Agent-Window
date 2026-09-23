from __future__ import annotations

import subprocess

from backend_core.tmux import TMUX


def trace_content(pane_id: str, *, tail_lines: int) -> str:
    result = subprocess.run(
        [*TMUX, "capture-pane", "-p", "-S", f"-{tail_lines}", "-t", pane_id],
        capture_output=True,
        text=True,
        timeout=3,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"tmux capture-pane failed (exit {result.returncode}): {detail}")
    return "\n".join(line.rstrip() for line in result.stdout.splitlines())
