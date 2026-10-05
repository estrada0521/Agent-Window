from __future__ import annotations


from tmux import run_tmux


def trace_content(pane_id: str, *, tail_lines: int) -> str:
    result = run_tmux(["capture-pane", "-p", "-S", f"-{tail_lines}", "-t", pane_id], timeout=3)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"tmux capture-pane failed (exit {result.returncode}): {detail}")
    return "\n".join(line.rstrip() for line in result.stdout.splitlines())
