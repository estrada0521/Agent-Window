from __future__ import annotations

import os
from pathlib import Path

from backend_core.agents.names import agent_base_name as _agent_base_name


def _normalized_native_log_path(path: str | Path) -> str:
    raw = str(path or "").strip()
    if not raw:
        return ""
    return os.path.realpath(str(Path(raw).expanduser()))


def _load_path_progress(raw: object) -> dict[str, int]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("native_log_progress must be an object")
    result: dict[str, int] = {}
    for path, position in raw.items():
        if not isinstance(path, str) or not path:
            raise ValueError("native_log_progress keys must be paths")
        if not isinstance(position, int) or isinstance(position, bool) or position < 0:
            raise ValueError(f"native_log_progress[{path!r}] must be a non-negative int")
        result[path] = position
    return result


def _load_pane_paths(raw: object) -> dict[str, str]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("native_log_current_paths must be an object")
    result: dict[str, str] = {}
    for agent, path in raw.items():
        if not isinstance(agent, str) or not agent:
            raise ValueError("native_log_current_paths keys must be agent names")
        if not isinstance(path, str) or not path:
            raise ValueError(f"native_log_current_paths[{agent!r}] must be a path")
        result[agent] = path
    return result


def read_progress_start(
    progress: dict[str, int],
    path: str,
    file_size: int,
    *,
    on_shrink: str = "error",
) -> int:
    """Where to resume reading `path` from: the recorded high-water mark, or 0
    if this exact file has never been synced before.

    A native log is never supposed to shrink. Guessing (replay from 0) is
    forbidden. `on_shrink="wait"` keeps the recorded offset so the caller can
    return until the file is at least that large again (Cursor last-line
    rewrite). Anything else raises.
    """
    if on_shrink not in {"error", "wait"}:
        raise ValueError(f"unknown on_shrink: {on_shrink}")
    key = _normalized_native_log_path(path)
    start = progress.get(key, 0)
    if file_size < start:
        if on_shrink == "wait":
            return start
        raise RuntimeError(
            f"native log shrank: {path} size={file_size} progress={start}"
        )
    return start


def advance_read_progress(progress: dict[str, int], path: str, position: int) -> None:
    progress[_normalized_native_log_path(path)] = position
