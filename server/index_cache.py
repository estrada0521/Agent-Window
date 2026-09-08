from __future__ import annotations

import json
import os
from collections import deque
from pathlib import Path

from native_log_sync.redacted import omit_redacted_log_entry

MATCHED_ENTRY_TAIL = 64
_REVERSE_READ_BLOCK = 64 * 1024


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


def _iter_matched_log_entries_reversed(path: Path):
    """Yield matched log entries newest-first, reading the file back from EOF.

    Work is bounded by how far back the caller consumes -- it never scans the
    whole file to serve a window near the tail.
    """
    with path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        pos = handle.tell()
        carry = b""  # bytes of a line whose newline sits to the right of `pos`
        dropped_partial_tail = False
        while pos > 0:
            size = min(_REVERSE_READ_BLOCK, pos)
            pos -= size
            handle.seek(pos)
            chunk = handle.read(size) + carry
            if not dropped_partial_tail:
                dropped_partial_tail = True
                if chunk and not chunk.endswith((b"\n", b"\r")):
                    nl = chunk.rfind(b"\n")
                    chunk = chunk[: nl + 1] if nl != -1 else b""
            if pos > 0:
                split = chunk.find(b"\n")
                if split == -1:
                    carry = chunk  # no line boundary yet -- fold into the next block
                    continue
                carry, body = chunk[:split], chunk[split + 1:]
            else:
                carry, body = b"", chunk  # reached BOF: `body` starts on a line boundary
            end = len(body)
            while end > 0:
                start = body.rfind(b"\n", 0, end - 1) + 1
                raw = body[start:end]
                end = start
                if not raw:
                    continue
                kind, entry = _classify_log_segment(raw)
                if kind == "entry" and entry is not None:
                    yield entry


def _entry_window_from_tail(path: Path, offset: int, limit: int):
    picked: list[dict] = []
    skipped = 0
    for entry in _iter_matched_log_entries_reversed(path):
        if skipped < offset:
            skipped += 1
            continue
        picked.append(entry)
        if len(picked) >= limit:
            break
    picked.reverse()
    return picked


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
        batch = _entry_window_from_tail(log_path, offset, limit)
        return batch, total_count > offset + len(batch), total_count
    if len(tail) >= min(limit, total_count):
        return tail[-limit:], total_count > limit, total_count
    batch = _entry_window_from_tail(log_path, 0, limit)
    return batch, total_count > len(batch), total_count
