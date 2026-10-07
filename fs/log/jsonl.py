from __future__ import annotations

import fcntl
import hashlib
import json
from pathlib import Path
import os
import re
from datetime import datetime, timedelta


def _context_hash(*parts: object) -> str:
    key = ":".join(str(part) for part in parts)
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]


def append_jsonl_entry(path: Path | str, entry: dict) -> dict:
    target = Path(path)
    entry = {
        **entry,
        "context_hash": _context_hash(
            entry.get("timestamp"),
            entry.get("sender"),
            entry.get("message"),
        ),
    }
    line = json.dumps(entry, ensure_ascii=False) + "\n"
    with target.open("a", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            handle.write(line)
            handle.flush()
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    return entry


_REVERSE_READ_BLOCK = 64 * 1024


def iter_log_lines_reversed(path: Path, *, end_offset: int | None = None, with_offsets: bool = False):
    with path.open("rb") as handle:
        if end_offset is None:
            handle.seek(0, os.SEEK_END)
        else:
            handle.seek(end_offset)
        pos = handle.tell()
        carry = b""
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
                    carry = chunk
                    continue
                carry, body = chunk[:split + 1], chunk[split + 1:]
                body_offset = pos + split + 1
            else:
                carry, body = b"", chunk
                body_offset = pos
            end = len(body)
            while end > 0:
                start = body.rfind(b"\n", 0, end - 1) + 1
                raw = body[start:end]
                end = start
                if raw:
                    yield (body_offset + start, raw) if with_offsets else raw


def iter_log_entries_reversed(path: Path):
    for raw in iter_log_lines_reversed(path):
        yield json.loads(raw)


def log_slice(path: Path, *, start_hash: str, end_hash: str) -> bytes:
    picked: list[bytes] = []
    for raw in iter_log_lines_reversed(path):
        context_hash = json.loads(raw).get("context_hash")
        if not picked and context_hash != end_hash:
            continue
        picked.append(raw)
        if context_hash == start_hash:
            picked.reverse()
            return b"".join(picked)
    raise LookupError(f"context_hash {start_hash if picked else end_hash} not found in the log")


def newest_entries(path: Path, *, offset: int, limit: int) -> list[dict]:
    picked: list[dict] = []
    for index, entry in enumerate(iter_log_entries_reversed(path)):
        if index < offset:
            continue
        picked.append(entry)
        if len(picked) >= limit:
            break
    picked.reverse()
    return picked


def date_message_offset(path: Path, date: str) -> int:
    formats = {7: "%Y-%m", 10: "%Y-%m-%d", 13: "%Y-%m-%d %H", 16: "%Y-%m-%d %H:%M", 19: "%Y-%m-%d %H:%M:%S"}
    start = datetime.strptime(date, formats[len(date)])
    if len(date) == 7:
        end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    else:
        end = start + {10: timedelta(days=1), 13: timedelta(hours=1), 16: timedelta(minutes=1), 19: timedelta(seconds=1)}[len(date)]
    lower, upper = (value.strftime("%Y-%m-%d %H:%M:%S").encode() for value in (start, end))
    timestamp = re.compile(rb'"timestamp"\s*:\s*"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})"')
    match_offset = None
    prior = None
    offset = 0
    with path.open("rb") as handle:
        for raw in handle:
            if not raw.endswith(b"\n"):
                break
            stamp = timestamp.search(raw)[1]
            if lower <= stamp < upper and match_offset is None:
                match_offset = offset
            elif stamp < lower and (prior is None or stamp >= prior[0]):
                prior = (stamp, offset)
            offset += len(raw)
    if match_offset is not None:
        return match_offset
    if prior is None:
        raise LookupError("No earlier messages")
    return prior[1]


def message_window(path: Path, *, cursor: int, limit: int, before: bool = False) -> dict:
    entries = []
    if before:
        position = cursor
        for raw in iter_log_lines_reversed(path, end_offset=cursor):
            if len(entries) == limit:
                break
            position -= len(raw)
            entries.append(json.loads(raw))
        entries.reverse()
        return {"entries": entries, "before": position, "after": cursor, "has_older": position > 0}
    with path.open("rb") as handle:
        handle.seek(cursor)
        while len(entries) < limit:
            position = handle.tell()
            raw = handle.readline()
            if not raw or not raw.endswith(b"\n"):
                handle.seek(position)
                break
            entries.append(json.loads(raw))
        after = handle.tell()
        has_newer = handle.readline().endswith(b"\n")
    return {"entries": entries, "before": cursor, "after": after, "has_older": cursor > 0, "has_newer": has_newer}


def search_messages(path: Path, query: str) -> list[int]:
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    return [offset for offset, raw in iter_log_lines_reversed(path, with_offsets=True)
            if pattern.search(json.loads(raw)["message"])]
