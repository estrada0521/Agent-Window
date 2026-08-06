from __future__ import annotations

import fcntl
import json
import logging
import os
import time

from native_log_sync.agents._shared.path_state import (
    _agent_base_name,
    _normalized_native_log_path,
)
from native_log_sync.io.state_paths import (
    canonical_native_log_sync_internal_path,
    canonical_native_log_sync_state_path,
    legacy_agent_index_sync_state_path,
)

_INTERNAL_KEYS = ("agent_first_seen_ts", "native_log_progress")

# Pre-redesign per-agent cursor keys: {"agent": [path, offset], ...}. A session
# whose internal file predates the path-progress model has none of the
# _INTERNAL_KEYS above, so without this fallback every native log would be
# treated as never-read and replayed from byte 0 on next load.
_LEGACY_CURSOR_KEYS = (
    "claude_cursors",
    "codex_cursors",
    "cursor_cursors",
    "gemini_cursors",
    "grok_cursors",
)


def _migrate_legacy_cursors_to_progress(data: dict) -> dict[str, int]:
    progress: dict[str, int] = {}
    for key in _LEGACY_CURSOR_KEYS:
        cursors = data.get(key)
        if not isinstance(cursors, dict):
            continue
        for value in cursors.values():
            if not isinstance(value, (list, tuple)) or len(value) != 2:
                continue
            path, offset = value
            if isinstance(path, str) and path and isinstance(offset, int):
                progress[_normalized_native_log_path(path)] = offset
    return progress


def _read_json_locked(path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_SH)
            raw = handle.read().strip()
            if not raw:
                return {}
            return json.loads(raw)
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        return {}


def load_sync_state(runtime) -> dict:
    canonical = canonical_native_log_sync_state_path(runtime.index_path.parent)
    legacy = legacy_agent_index_sync_state_path(runtime.index_path.parent)
    internal = canonical_native_log_sync_internal_path(runtime.index_path.parent)

    if canonical.exists():
        read_path = canonical
    elif legacy.exists():
        read_path = legacy
    else:
        read_path = None

    data: dict = _read_json_locked(read_path) if read_path is not None else {}

    if read_path == legacy:
        try:
            legacy.rename(canonical)
        except OSError:
            try:
                canonical.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                legacy.unlink()
            except OSError:
                pass
    elif legacy.exists():
        try:
            legacy.unlink()
        except OSError:
            pass

    # Internal bookkeeping (read-progress ledger, first-seen timestamps) lives
    # in its own file, not the workspace-mirrored one. Once it exists it is
    # the source of truth for these keys.
    internal_data: dict = {}
    if internal.exists():
        internal_data = _read_json_locked(internal)
        for key in _INTERNAL_KEYS:
            if key in internal_data:
                data[key] = internal_data[key]

    if "native_log_progress" not in internal_data:
        legacy_progress = _migrate_legacy_cursors_to_progress(data)
        if legacy_progress:
            data["native_log_progress"] = legacy_progress

    return data


def save_sync_state(runtime, *, time_module=time) -> None:
    last_sync = time_module.strftime("%Y-%m-%d %H:%M:%S")
    try:
        pointer_state = {
            "native_log_current_paths": dict(runtime._native_log_current_paths),
            "last_sync": last_sync,
        }
        with canonical_native_log_sync_state_path(runtime.index_path.parent).open("w", encoding="utf-8") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            handle.write(json.dumps(pointer_state, ensure_ascii=False))
            handle.flush()
            os.fsync(handle.fileno())

        internal_state = {
            "agent_first_seen_ts": dict(runtime._agent_first_seen_ts),
            "native_log_progress": dict(runtime._native_log_progress),
            "last_sync": last_sync,
        }
        with canonical_native_log_sync_internal_path(runtime.index_path.parent).open("w", encoding="utf-8") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            handle.write(json.dumps(internal_state, ensure_ascii=False))
            handle.flush()
            os.fsync(handle.fileno())
    except Exception as exc:
        logging.error("Failed to save sync state: %s", exc)


def sync_cursor_status(runtime, *, os_module=os) -> list[dict]:
    result: list[dict] = []
    for agent in runtime.active_agents():
        path = runtime._native_log_current_paths.get(agent)
        entry: dict = {
            "agent": agent,
            "type": _agent_base_name(agent),
            "log_path": path,
            "offset": None,
            "file_size": None,
            "first_seen_ts": runtime._first_seen_for_agent(agent),
        }
        if path:
            entry["offset"] = runtime._native_log_progress.get(_normalized_native_log_path(path))
            try:
                entry["file_size"] = os_module.path.getsize(path)
            except OSError:
                entry["file_size"] = None
        result.append(entry)
    return result
