from __future__ import annotations

import fcntl
import json
import os
import time

from backend_core.access.atomic_json import write_json_atomically
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


def save_sync_state(runtime, *, time_module=time) -> None:
    last_sync = time_module.strftime("%Y-%m-%d %H:%M:%S")
    session_dir = runtime.log_path.parent
    pointer_state = {
        "native_log_current_paths": dict(runtime._native_log_current_paths),
        "last_sync": last_sync,
    }
    write_json_atomically(canonical_native_log_sync_state_path(session_dir), pointer_state)

    internal_state = {
        "agent_first_seen_ts": dict(runtime._agent_first_seen_ts),
        "native_log_progress": dict(runtime._native_log_progress),
        "last_sync": last_sync,
    }
    internal_path = canonical_native_log_sync_internal_path(session_dir)
    write_json_atomically(internal_path, internal_state)

    # Both renames above only guarantee the file *content* is durable; the
    # directory entry pointing at the new inode still needs its own fsync
    # to survive a crash right after the rename.
    dir_fd = os.open(str(internal_path.parent), os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)
