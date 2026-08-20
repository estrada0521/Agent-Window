from __future__ import annotations

import fcntl
import hashlib
import json
from pathlib import Path


def _content_msg_id(*parts: object) -> str:
    key = ":".join(str(part) for part in parts)
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]


def append_jsonl_entry(path: Path | str, entry: dict) -> dict:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        **entry,
        "msg_id": _content_msg_id(
            entry.get("timestamp"),
            entry.get("session"),
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
