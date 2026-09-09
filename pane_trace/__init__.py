"""Rendered-text capture of a tmux pane for the mobile chat's Pane Trace sheet.

Mobile-only. On desktop the user opens the real pane in Terminal
(the /open-terminal route), so nothing there reaches this -- the sole
consumer is apps/mobile/chat/panes/pane-viewer.js via the /trace route.
"""

from __future__ import annotations

from .pane import capture_pane_text


def trace_content(
    runtime,
    pane_id: str,
    *,
    tail_lines: int,
) -> str:
    n = max(1, min(int(tail_lines), 10_000))
    raw = capture_pane_text(
        runtime,
        pane_id,
        start=f"-{n}",
        include_escape=True,
        timeout_seconds=3,
    )
    return "\n".join(line.rstrip() for line in raw.splitlines())
