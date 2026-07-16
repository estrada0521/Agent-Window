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
from native_log_sync.agents._shared.runtime_push import push_runtime_display
from native_log_sync.agents.grok.read_runtime import (
    iter_tool_calls_from_update,
    runtime_tool_events,
)
from native_log_sync.duplicate import already_synced_message, mark_message_synced


def extract_grok_assistant_text(entry: object) -> str:
    if not isinstance(entry, dict) or entry.get("type") != "assistant":
        return ""
    if entry.get("tool_calls"):
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


def _sync_latest_final_assistant(runtime, agent: str, history_path: str) -> bool:
    """Backfill only the final reply that may precede first file binding."""
    latest: tuple[int, object] | None = None
    try:
        with open(history_path, "r", encoding="utf-8") as handle:
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
    return _append_grok_entry(runtime, agent, history_path, *latest)


def _turn_completed(entry: object) -> bool:
    if not isinstance(entry, dict):
        return False
    params = entry.get("params")
    if not isinstance(params, dict):
        return False
    update = params.get("update")
    return (
        isinstance(update, dict)
        and update.get("sessionUpdate") == "turn_completed"
        and update.get("stop_reason") == "end_turn"
    )


def _chat_history_path(updates_path: str) -> str:
    candidate = Path(updates_path).with_name("chat_history.jsonl")
    return str(candidate) if candidate.is_file() else ""


def sync_grok_native_log(runtime, agent: str, native_log_path: str | None = None) -> None:
    """Sync completed Grok turns from its append-only update stream."""
    try:
        updates_path = str(native_log_path or "").strip()
        if not updates_path or not os.path.isfile(updates_path):
            return
        history_path = _chat_history_path(updates_path)
        if not history_path:
            return
        file_size = os.path.getsize(updates_path)
        previous = runtime._grok_cursors.get(agent)
        offset = _advance_native_cursor(runtime._grok_cursors, agent, updates_path, file_size)
        if offset is None:
            binding_changed = _cursor_binding_changed(previous, runtime._grok_cursors.get(agent))
            appended = _sync_latest_final_assistant(runtime, agent, history_path) if binding_changed else False
            if binding_changed:
                runtime.save_sync_state()
            return

        turn_completed = False
        workspace = str(getattr(runtime, "workspace", "") or "")
        with open(updates_path, "r", encoding="utf-8") as handle:
            handle.seek(offset)
            while True:
                line = handle.readline()
                if not line:
                    break
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                turn_completed = _turn_completed(entry) or turn_completed
                tool_evs: list[dict] = []
                for name, inp in iter_tool_calls_from_update(entry):
                    tool_evs.extend(runtime_tool_events(name, inp, workspace=workspace))
                if tool_evs:
                    push_runtime_display(runtime, agent, tool_evs)

        runtime._grok_cursors[agent] = NativeLogCursor(path=updates_path, offset=file_size)
        runtime.save_sync_state()
        if turn_completed:
            _sync_latest_final_assistant(runtime, agent, history_path)
            runtime._mark_idle(agent)
    except Exception as exc:
        logging.error("Failed to sync Grok message for %s: %s", agent, exc, exc_info=True)
