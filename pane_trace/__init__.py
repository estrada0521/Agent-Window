from __future__ import annotations

from .pane import capture_pane_text


def trace_content(
    runtime,
    pane_id: str,
    *,
    tail_lines: int | None = None,
) -> str:
    if tail_lines is not None:
        n = max(1, min(int(tail_lines), 10_000))
        start = f"-{n}"
        cap_timeout = 3
    else:
        start = "-500000"
        cap_timeout = 8
    raw = capture_pane_text(
        runtime,
        pane_id,
        start=start,
        include_escape=True,
        timeout_seconds=cap_timeout,
    )
    return "\n".join(line.rstrip() for line in raw.splitlines())
