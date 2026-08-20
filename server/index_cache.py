from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from native_log_sync.redacted import omit_redacted_log_entry

MATCHED_ENTRY_TAIL = 64


def _classify_log_segment(raw_segment: bytes) -> tuple[str, dict | None]:
    complete = raw_segment.endswith((b"\n", b"\r"))
    try:
        line = raw_segment.rstrip(b"\r\n").decode("utf-8").strip()
    except UnicodeDecodeError:
        if not complete:
            return "incomplete", None
        raise
    if not line:
        return "skip", None
    try:
        entry = json.loads(line)
    except json.JSONDecodeError:
        if not complete:
            return "incomplete", None
        raise
    if not isinstance(entry, dict):
        raise RuntimeError("unified log line is not an object")
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
    stat = runtime.log_path.stat()
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
    runtime._matched_entries_total = total
    runtime._matched_entries_cache_size = processed_size
    runtime._matched_entries_cache_sig = (
        current_sig if processed_size == stat.st_size else (processed_size, 0)
    )


def _window_before_offset_from_disk(path: Path, offset: int, limit: int, total_count: int):
    window: deque[dict] = deque(maxlen=offset + limit)
    for entry in _iter_matched_log_entries(path):
        window.append(entry)
    kept = list(window)
    older_batch = kept[: max(0, len(kept) - offset)]
    has_older = total_count > offset + len(older_batch)
    return older_batch, has_older, total_count


def _window_tail_from_disk(path: Path, limit: int, total_count: int):
    window: deque[dict] = deque(maxlen=limit)
    for entry in _iter_matched_log_entries(path):
        window.append(entry)
    return list(window), total_count > limit, total_count


def message_entry_window(
    runtime,
    *,
    limit_override: int | None,
    default_limit: int,
    offset: int = 0,
) -> tuple[list[dict], bool, int]:
    limit = limit_override if limit_override is not None else default_limit
    if not limit or limit <= 0:
        limit = default_limit
    with runtime._matched_entries_cache_lock:
        _ingest_matched_tail(runtime)
        total_count = runtime._matched_entries_total
        tail = list(runtime._matched_entries_cache_entries)
        log_path = runtime.log_path
    if offset > 0:
        return _window_before_offset_from_disk(log_path, offset, limit, total_count)
    if len(tail) >= min(limit, total_count):
        return tail[-limit:], total_count > limit, total_count
    return _window_tail_from_disk(log_path, limit, total_count)
