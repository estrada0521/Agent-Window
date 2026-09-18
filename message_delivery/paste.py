from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any


def deliver_text_to_pane(
    run_tmux: Callable[[list[str]], Any],
    pane_id: str,
    payload: str,
) -> bool:
    pane = str(pane_id or "").strip()
    if not pane:
        return False
    if run_tmux(["send-keys", "-t", pane, "-l", "--", str(payload)]).returncode != 0:
        return False
    time.sleep(0.2)
    return run_tmux(["send-keys", "-t", pane, "", "Enter"]).returncode == 0
