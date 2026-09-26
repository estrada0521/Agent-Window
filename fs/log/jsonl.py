from __future__ import annotations

import fcntl
import hashlib
import json
from pathlib import Path
import os


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


def iter_log_entries_reversed(path: Path):
    with path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
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
                carry, body = chunk[:split], chunk[split + 1:]
            else:
                carry, body = b"", chunk
            end = len(body)
            while end > 0:
                start = body.rfind(b"\n", 0, end - 1) + 1
                raw = body[start:end]
                end = start
                if raw:
                    yield json.loads(raw)


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
