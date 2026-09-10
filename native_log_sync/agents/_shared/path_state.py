from __future__ import annotations

import os
from pathlib import Path

def _normalized_native_log_path(path: str | Path) -> str:
    raw = str(path or "").strip()
    if not raw:
        return ""
    return os.path.realpath(str(Path(raw).expanduser()))


def read_offset_start(
    offsets: dict[str, int],
    path: str,
    file_size: int,
    *,
    on_shrink: str = "error",
) -> int:
    """Where this process resumes reading `path`, or 0 on first observation.

    A native log is never supposed to shrink. Guessing (replay from 0) is
    forbidden. `on_shrink="wait"` keeps the recorded offset so the caller can
    return until the file is at least that large again (Cursor last-line
    rewrite). Anything else raises.
    """
    if on_shrink not in {"error", "wait"}:
        raise ValueError(f"unknown on_shrink: {on_shrink}")
    key = _normalized_native_log_path(path)
    start = offsets.get(key, 0)
    if file_size < start:
        if on_shrink == "wait":
            return start
        raise RuntimeError(
            f"native log shrank: {path} size={file_size} progress={start}"
        )
    return start


def advance_read_offset(offsets: dict[str, int], path: str, position: int) -> None:
    offsets[_normalized_native_log_path(path)] = position
