from __future__ import annotations

import json

from native_log_sync.entry_kind import should_omit_entry_from_chat
from native_log_sync.redacted import omit_redacted_log_entry


def matched_entries(runtime) -> list[dict]:
    if not runtime.index_path.exists():
        return []
    try:
        stat = runtime.index_path.stat()
    except OSError:
        return []
    current_sig = (stat.st_size, stat.st_mtime_ns)
    with runtime._matched_entries_cache_lock:
        if runtime._matched_entries_cache_sig == current_sig:
            return list(runtime._matched_entries_cache_entries)
        can_append = (
            runtime._matched_entries_cache_size > 0
            and stat.st_size > runtime._matched_entries_cache_size
        )
        if can_append:
            entries = list(runtime._matched_entries_cache_entries)
            start_offset = runtime._matched_entries_cache_size
        else:
            entries = []
            start_offset = 0
        read_size = max(0, stat.st_size - start_offset)
        try:
            with runtime.index_path.open("rb") as f:
                f.seek(start_offset)
                chunk = f.read(read_size)
        except OSError:
            return list(entries)

        processed_size = start_offset
        for raw_segment in chunk.splitlines(keepends=True):
            line = raw_segment.rstrip(b"\r\n").decode("utf-8", errors="replace").strip()
            if not line:
                processed_size += len(raw_segment)
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                if not raw_segment.endswith((b"\n", b"\r")):
                    break
                processed_size += len(raw_segment)
                continue
            if should_omit_entry_from_chat(entry):
                processed_size += len(raw_segment)
                continue
            if omit_redacted_log_entry(str(entry.get("message") or "")):
                processed_size += len(raw_segment)
                continue
            entries.append(entry)
            processed_size += len(raw_segment)
        runtime._matched_entries_cache_sig = (
            current_sig if processed_size == stat.st_size else (processed_size, 0)
        )
        runtime._matched_entries_cache_size = processed_size
        runtime._matched_entries_cache_entries = entries
        return list(entries)
