from __future__ import annotations

from pathlib import Path

from backend_core.access.files import append_jsonl_entry


def append_projected_entry(path: Path | str, entry: dict) -> None:
    native_path = str(entry.get("native_log_path") or "").strip()
    offset = entry.get("native_log_offset")
    if not native_path:
        raise ValueError("projected entry requires native_log_path")
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        raise ValueError("projected entry requires native_log_offset")
    append_jsonl_entry(path, entry)
