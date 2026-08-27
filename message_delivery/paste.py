from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from typing import Any

from message_delivery.paste_timing import delivery_paste_delay_seconds


def deliver_text_to_pane(
    run_tmux: Callable[[list[str]], Any],
    pane_id: str,
    payload: str,
    *,
    env: Mapping[str, str] | None = None,
) -> bool:
    pane = str(pane_id or "").strip()
    if not pane:
        return False
    if run_tmux(["send-keys", "-t", pane, "-l", "--", str(payload)]).returncode != 0:
        return False
    time.sleep(delivery_paste_delay_seconds(env=env))
    return run_tmux(["send-keys", "-t", pane, "", "Enter"]).returncode == 0
