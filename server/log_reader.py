from __future__ import annotations

import json
import os
from pathlib import Path

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
