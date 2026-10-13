from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any


def deliver_text_to_pane(
    run_tmux: Callable[[list[str]], Any],
    pane_id: str,
    payload: str,
) -> str:
    pane = str(pane_id or "").strip()
    if not pane:
        return "Pane not found"
    state = run_tmux(["display-message", "-p", "-t", pane, "#{pane_dead} #{pane_in_mode}"])
    if state.returncode != 0:
        return f"Cannot read pane state: {state.stderr.strip()}"
    fields = state.stdout.strip().split()
    if len(fields) != 2:
        return "Invalid pane state"
    dead, in_mode = fields
    if dead == "1":
        return "Pane is dead. Restart the agent."
    if in_mode != "0":
        result = run_tmux(["send-keys", "-t", pane, "-X", "cancel"])
        if result.returncode != 0:
            return f"Cannot leave pane scroll mode: {result.stderr.strip()}"
    result = run_tmux(["send-keys", "-t", pane, "-l", "--", str(payload)])
    if result.returncode != 0:
        return f"Cannot deliver text: {result.stderr.strip()}"
    time.sleep(0.2)
    result = run_tmux(["send-keys", "-t", pane, "", "Enter"])
    return f"Cannot send Enter: {result.stderr.strip()}" if result.returncode != 0 else ""
