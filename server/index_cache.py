from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from native_log_sync.entry_kind import should_omit_entry_from_chat
from native_log_sync.redacted import omit_redacted_log_entry

MATCHED_ENTRY_TAIL = 64


def _classify_log_segment(raw_segment: bytes) -> tuple[str, dict | None]:
    line = raw_segment.rstrip(b"\r\n").decode("utf-8", errors="replace").strip()
    if not line:
        return "skip", None
    try:
        entry = json.loads(line)
    except json.JSONDecodeError:
        if not raw_segment.endswith((b"\n", b"\r")):
            return "incomplete", None
        return "skip", None
    if should_omit_entry_from_chat(entry):
        return "skip", None
    if omit_redacted_log_entry(str(entry.get("message") or "")):
        return "skip", None
    return "entry", entry


def _iter_matched_log_entries(path: Path, *, start: int = 0):
    with path.open("rb") as handle:
        handle.seek(start)
        for raw_segment in handle:
            kind, entry = _classify_log_segment(raw_segment)
            if kind == "incomplete":
                return
            if kind == "entry" and entry is not None:
                yield entry


def _ingest_matched_tail(runtime) -> None:
    tail: deque = runtime._matched_entries_cache_entries
    if not runtime.log_path.exists():
        runtime._matched_entries_cache_sig = (0, 0)
        runtime._matched_entries_cache_size = 0
        tail.clear()
        runtime._matched_entries_total = 0
        return
    try:
        stat = runtime.log_path.stat()
    except OSError:
        return
    current_sig = (stat.st_size, stat.st_mtime_ns)
    if runtime._matched_entries_cache_sig == current_sig:
        return
    can_append = (
        runtime._matched_entries_cache_size > 0
        and stat.st_size > runtime._matched_entries_cache_size
    )
    if can_append:
        start_offset = runtime._matched_entries_cache_size
        total = runtime._matched_entries_total
    else:
        tail.clear()
        start_offset = 0
        total = 0
    processed_size = start_offset
    try:
        with runtime.log_path.open("rb") as handle:
            handle.seek(start_offset)
            for raw_segment in handle:
                kind, entry = _classify_log_segment(raw_segment)
                if kind == "incomplete":
                    break
                processed_size += len(raw_segment)
                if kind == "entry" and entry is not None:
                    tail.append(entry)
                    total += 1
    except OSError:
        runtime._matched_entries_total = total
        runtime._matched_entries_cache_size = processed_size
        return
    runtime._matched_entries_total = total
    runtime._matched_entries_cache_size = processed_size
    runtime._matched_entries_cache_sig = (
        current_sig if processed_size == stat.st_size else (processed_size, 0)
    )


def _window_before_from_disk(path: Path, before_msg_id: str, limit: int, total_count: int):
    window: deque[dict] = deque(maxlen=limit)
    overflow = False
    found = False
    try:
        for entry in _iter_matched_log_entries(path):
            if str(entry.get("msg_id") or "") == before_msg_id:
                found = True
                break
            if len(window) == limit:
                overflow = True
            window.append(entry)
    except OSError:
        return [], False, total_count
    if not found:
        return [], False, total_count
    return list(window), overflow, total_count


def _window_tail_from_disk(path: Path, limit: int, total_count: int):
    window: deque[dict] = deque(maxlen=limit)
    try:
        for entry in _iter_matched_log_entries(path):
            window.append(entry)
    except OSError:
        return [], False, total_count
    return list(window), total_count > limit, total_count


def message_entry_window(
    runtime,
    *,
    limit_override: int | None,
    default_limit: int,
    before_msg_id: str = "",
) -> tuple[list[dict], bool, int]:
    limit = limit_override if limit_override is not None else default_limit
    if not limit or limit <= 0:
        limit = default_limit
    with runtime._matched_entries_cache_lock:
        _ingest_matched_tail(runtime)
        total_count = runtime._matched_entries_total
        tail = list(runtime._matched_entries_cache_entries)
        log_path = runtime.log_path
    target = (before_msg_id or "").strip()
    if target:
        return _window_before_from_disk(log_path, target, limit, total_count)
    if len(tail) >= min(limit, total_count):
        return tail[-limit:], total_count > limit, total_count
    return _window_tail_from_disk(log_path, limit, total_count)


def find_matched_entry(runtime, msg_id: str) -> dict | None:
    target = (msg_id or "").strip()
    if not target:
        return None
    with runtime._matched_entries_cache_lock:
        _ingest_matched_tail(runtime)
        for entry in reversed(runtime._matched_entries_cache_entries):
            if str(entry.get("msg_id") or "") == target:
                return dict(entry)
        log_path = runtime.log_path
    try:
        for entry in _iter_matched_log_entries(log_path):
            if str(entry.get("msg_id") or "") == target:
                return entry
    except OSError:
        return None
    return None
