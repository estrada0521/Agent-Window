from __future__ import annotations

import json
import os
from collections import deque
from pathlib import Path

MATCHED_ENTRY_TAIL = 64
_REVERSE_READ_BLOCK = 64 * 1024


def iter_log_entries_reversed(path: Path):
    """Yield log entries newest-first, reading the file back from EOF.

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
                nl = chunk.rfind(b"\n")
                if nl == -1:
                    continue
                dropped_partial_tail = True
                chunk = chunk[: nl + 1]
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
                if raw:
                    yield json.loads(raw)


def _entry_window_from_tail(path: Path, offset: int, limit: int):
    picked: list[dict] = []
    skipped = 0
    for entry in iter_log_entries_reversed(path):
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
            if not raw_segment.endswith(b"\n"):
                break
            processed_size += len(raw_segment)
            tail.append(json.loads(raw_segment))
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
