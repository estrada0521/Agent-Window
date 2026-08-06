from __future__ import annotations

import os
from pathlib import Path

from backend_core.agents.names import agent_base_name as _agent_base_name
from backend_core.agents.names import agent_instance_number as _agent_instance_number


def _normalized_native_log_path(path: str | Path) -> str:
    raw = str(path or "").strip()
    if not raw:
        return ""
    try:
        return os.path.realpath(str(Path(raw).expanduser()))
    except OSError:
        return str(Path(raw).expanduser())


def _load_path_progress(raw: object) -> dict[str, int]:
    result: dict[str, int] = {}
    if isinstance(raw, dict):
        for path, position in raw.items():
            if isinstance(path, str) and path and isinstance(position, int) and Path(path).is_file():
                result[path] = position
    return result


def _load_pane_paths(raw: object) -> dict[str, str]:
    result: dict[str, str] = {}
    if isinstance(raw, dict):
        for agent, path in raw.items():
            if isinstance(agent, str) and isinstance(path, str) and path:
                result[agent] = path
    return result


def read_progress_start(progress: dict[str, int], path: str, file_size: int) -> int:
    """Where to resume reading `path` from: the recorded high-water mark, or 0
    if this exact file has never been synced before (new chat, or the first
    time this install has ever seen this native log). If the file is smaller
    than the recorded mark, it was truncated or replaced; restart from 0.
    """
    key = _normalized_native_log_path(path)
    start = progress.get(key, 0)
    if file_size < start:
        return 0
    return start


def advance_read_progress(progress: dict[str, int], path: str, position: int) -> None:
    progress[_normalized_native_log_path(path)] = position
