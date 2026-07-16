from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path

from backend_core.access.files import append_jsonl_entry
from native_log_sync.agents._shared.path_state import (
    NativeLogCursor,
    _advance_native_cursor,
    _cursor_binding_changed,
)
from native_log_sync.duplicate import already_synced_message, mark_message_synced


def extract_grok_assistant_text(entry: object) -> str:
    if not isinstance(entry, dict) or entry.get("type") != "assistant":
        return ""
    content = entry.get("content")
    return content.strip() if isinstance(content, str) else ""


def _append_grok_entry(runtime, agent: str, path: str, line_start: int, entry: object) -> bool:
    display = extract_grok_assistant_text(entry)
    if not display:
        return False
    key = f"grok:{agent}:{path}:{line_start}".encode("utf-8")
    msg_id = hashlib.sha256(key).hexdigest()[:12]
    if already_synced_message(runtime, agent, display, msg_id):
        return False
    append_jsonl_entry(
        runtime.index_path,
        {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "session": runtime.session_name,
            "sender": agent,
            "targets": ["user"],
            "message": display,
            "msg_id": msg_id,
        },
    )
    mark_message_synced(runtime, agent, display, msg_id)
    return True


def _sync_initial_latest_assistant(runtime, agent: str, path: str) -> bool:
    """Backfill only the final reply that may precede first file binding."""
    latest: tuple[int, object] | None = None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            while True:
                line_start = handle.tell()
                line = handle.readline()
                if not line:
                    break
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if extract_grok_assistant_text(entry):
                    latest = (line_start, entry)
    except OSError:
        return False
    if latest is None:
        return False
    return _append_grok_entry(runtime, agent, path, *latest)


def sync_grok_native_log(runtime, agent: str, native_log_path: str | None = None) -> None:
    """Sync final assistant messages from Grok's append-only chat history."""
    try:
        path = str(native_log_path or "").strip()
        if not path or not os.path.isfile(path):
            return
        file_size = os.path.getsize(path)
        previous = runtime._grok_cursors.get(agent)
        offset = _advance_native_cursor(runtime._grok_cursors, agent, path, file_size)
        if offset is None:
            binding_changed = _cursor_binding_changed(previous, runtime._grok_cursors.get(agent))
            appended = _sync_initial_latest_assistant(runtime, agent, path) if binding_changed else False
            if binding_changed:
                runtime.save_sync_state()
            if appended:
                runtime._mark_idle(agent)
            return

        appended = False
        with open(path, "r", encoding="utf-8") as handle:
            handle.seek(offset)
            while True:
                line_start = handle.tell()
                line = handle.readline()
                if not line:
                    break
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                appended = _append_grok_entry(runtime, agent, path, line_start, entry) or appended

        runtime._grok_cursors[agent] = NativeLogCursor(path=path, offset=file_size)
        runtime.save_sync_state()
        if appended:
            runtime._mark_idle(agent)
    except Exception as exc:
        logging.error("Failed to sync Grok message for %s: %s", agent, exc, exc_info=True)
