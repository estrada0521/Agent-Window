from __future__ import annotations

import fcntl
import json
import os
import time

from native_log_sync.agents._shared.path_state import (
    _agent_base_name,
    _normalized_native_log_path,
)
from native_log_sync.io.state_paths import (
    canonical_native_log_sync_internal_path,
    canonical_native_log_sync_state_path,
)

_INTERNAL_KEYS = ("agent_first_seen_ts", "native_log_progress")


def _read_json_file(path) -> dict | None:
    try:
        handle = path.open("r", encoding="utf-8")
    except FileNotFoundError:
        return None
    with handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_SH)
        raw = handle.read()
    if not raw.strip():
        raise ValueError(f"empty sync state: {path}")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError(f"sync state is not an object: {path}")
    return data


def load_sync_state(runtime) -> dict:
    canonical = canonical_native_log_sync_state_path(runtime.log_path.parent)
    internal = canonical_native_log_sync_internal_path(runtime.log_path.parent)
    data = _read_json_file(canonical) or {}

    # Internal bookkeeping (read-progress ledger, first-seen timestamps) lives
    # in its own file, not the workspace-mirrored one. Once it exists it is
    # the source of truth for these keys.
    internal_data = _read_json_file(internal)
    if internal_data is not None:
        for key in _INTERNAL_KEYS:
            if key in internal_data:
                data[key] = internal_data[key]

    return data


def _atomic_write_json(path, data: dict) -> None:
    """Write `data` to `path` so a reader never observes a truncated file.

    A plain open(path, "w") truncates before the new content is written, so
    a crash mid-write leaves an empty/corrupt file behind. Writing to a
    sibling temp file first and renaming over the target makes the switch
    atomic: readers see either the old complete file or the new one.
    """
    tmp_path = path.with_name(f"{path.name}.tmp-{os.getpid()}")
    with tmp_path.open("w", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        handle.write(json.dumps(data, ensure_ascii=False))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp_path, path)


def save_sync_state(runtime, *, time_module=time) -> None:
    last_sync = time_module.strftime("%Y-%m-%d %H:%M:%S")
    session_dir = runtime.log_path.parent
    pointer_state = {
        "native_log_current_paths": dict(runtime._native_log_current_paths),
        "last_sync": last_sync,
    }
    _atomic_write_json(canonical_native_log_sync_state_path(session_dir), pointer_state)

    internal_state = {
        "agent_first_seen_ts": dict(runtime._agent_first_seen_ts),
        "native_log_progress": dict(runtime._native_log_progress),
        "last_sync": last_sync,
    }
    internal_path = canonical_native_log_sync_internal_path(session_dir)
    _atomic_write_json(internal_path, internal_state)

    # Both renames above only guarantee the file *content* is durable; the
    # directory entry pointing at the new inode still needs its own fsync
    # to survive a crash right after the rename.
    dir_fd = os.open(str(internal_path.parent), os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


def sync_cursor_status(runtime, *, os_module=os) -> list[dict]:
    result: list[dict] = []
    for agent in runtime.active_agents():
        path = runtime._native_log_current_paths.get(agent)
        projection_status = getattr(runtime, "_native_log_projection_status", {}).get(agent, {"status": "ok"})
        entry: dict = {
            "agent": agent,
            "type": _agent_base_name(agent),
            "log_path": path,
            "offset": None,
            "file_size": None,
            "first_seen_ts": runtime._first_seen_for_agent(agent),
            "projection_status": projection_status.get("status", "ok"),
            "projection_detail": projection_status.get("detail", ""),
        }
        if path:
            entry["offset"] = runtime._native_log_progress.get(_normalized_native_log_path(path))
            entry["file_size"] = os_module.path.getsize(path)
        result.append(entry)
    return result
