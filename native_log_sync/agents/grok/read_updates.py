from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path

from backend_core.access.files import append_jsonl_entry
from native_log_sync.agents._shared.path_state import (
    _normalized_native_log_path,
    advance_read_progress,
    read_progress_start,
)
from native_log_sync.agents._shared.runtime_push import push_runtime_display
from native_log_sync.agents.grok.read_runtime import (
    iter_tool_calls_from_update,
    runtime_tool_events,
)


def extract_grok_assistant_text(entry: object) -> str:
    if not isinstance(entry, dict) or entry.get("type") != "assistant":
        return ""
    content = entry.get("content")
    return content.strip() if isinstance(content, str) else ""


def _append_grok_reply(runtime, agent: str, history_path: str, line_start: int, entry: dict) -> bool:
    display = extract_grok_assistant_text(entry)
    if not display:
        return False
    key = f"grok:{agent}:{history_path}:{line_start}".encode("utf-8")
    msg_id = hashlib.sha256(key).hexdigest()[:12]
    append_jsonl_entry(
        runtime.index_path,
        {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "session": runtime.session_name,
            "sender": agent,
            "targets": ["user"],
            "message": display,
            "msg_id": msg_id,
            "native_log_path": history_path,
            "native_log_offset": line_start,
        },
    )
    return True


def _sync_grok_chat_history(runtime, agent: str, history_path: str) -> bool:
    """Sync assistant replies from chat_history.jsonl not yet synced.

    The first time this exact file is seen, only backfill the single latest
    reply (there may be a long prior conversation in here that predates this
    Agent Window install ever watching it); every sync after that is a plain
    incremental read of whatever is new.
    """
    normalized = _normalized_native_log_path(history_path)
    is_first_encounter = normalized not in runtime._native_log_progress
    file_size = os.path.getsize(history_path)
    start = read_progress_start(runtime._native_log_progress, history_path, file_size)
    if start is None:
        logging.error(
            "Grok chat history %s shrank below the synced position; skipping this sync", history_path
        )
        return False
    if start >= file_size:
        return False

    appended = False
    if is_first_encounter:
        latest: tuple[int, dict] | None = None
        with open(history_path, "r", encoding="utf-8") as handle:
            handle.seek(start)
            while True:
                line_start = handle.tell()
                line = handle.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if extract_grok_assistant_text(entry):
                    latest = (line_start, entry)
        if latest is not None:
            appended = _append_grok_reply(runtime, agent, history_path, *latest)
    else:
        with open(history_path, "r", encoding="utf-8") as handle:
            handle.seek(start)
            while True:
                line_start = handle.tell()
                line = handle.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if _append_grok_reply(runtime, agent, history_path, line_start, entry):
                    appended = True

    advance_read_progress(runtime._native_log_progress, history_path, file_size)
    return appended


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
    """Sync new Grok replies as they land in chat_history.jsonl, and mark
    idle once the update stream reports the turn as complete."""
    try:
        updates_path = str(native_log_path or "").strip()
        if not updates_path or not os.path.isfile(updates_path):
            return
        history_path = _chat_history_path(updates_path)
        if not history_path:
            return

        runtime._native_log_current_paths[agent] = updates_path

        file_size = os.path.getsize(updates_path)
        start = read_progress_start(runtime._native_log_progress, updates_path, file_size)

        turn_completed = False
        if start is None:
            logging.error(
                "Grok updates log %s shrank below the synced position; skipping this sync", updates_path
            )
        else:
            if start < file_size:
                workspace = str(getattr(runtime, "workspace", "") or "")
                with open(updates_path, "r", encoding="utf-8") as handle:
                    handle.seek(start)
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

            advance_read_progress(runtime._native_log_progress, updates_path, file_size)

        _sync_grok_chat_history(runtime, agent, history_path)
        if turn_completed:
            runtime._mark_idle(agent)
        runtime.save_sync_state()
    except Exception as exc:
        logging.error(f"Failed to sync Grok message for {agent}: {exc}", exc_info=True)
