from __future__ import annotations

import os
import time
from pathlib import Path

from agents.read_offset import (
    _normalized_native_log_path,
    advance_read_offset,
    read_offset_start,
)
from agents.grok.read_running import (
    iter_tool_calls_from_update,
    running_tool_events,
)
from agents.jsonl_read import CompleteJsonlScan, report_skipped_lines
from fs.log.jsonl import append_jsonl_entry


def extract_grok_assistant_text(entry: object) -> str:
    if not isinstance(entry, dict) or entry.get("type") != "assistant":
        return ""
    content = entry.get("content")
    return content.strip() if isinstance(content, str) else ""


def _append_grok_reply(sync, agent: str, history_path: str, line_start: int, entry: dict) -> bool:
    display = extract_grok_assistant_text(entry)
    if not display:
        return False
    append_jsonl_entry(
        sync.log_path,
        {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "sender": agent,
            "targets": ["user"],
            "message": display,
            "native_log_path": history_path,
            "native_log_offset": line_start,
        },
    )
    return True


def _sync_grok_chat_history(sync, agent: str, history_path: str) -> bool:
    normalized = _normalized_native_log_path(history_path)
    is_first_encounter = normalized not in sync.offsets
    file_size = os.path.getsize(history_path)
    start = read_offset_start(sync.offsets, history_path, file_size)
    if start >= file_size:
        return False

    appended = False
    scan = CompleteJsonlScan(history_path, start)
    if is_first_encounter:
        latest: tuple[int, dict] | None = None
        for line_start, entry in scan:
            if extract_grok_assistant_text(entry):
                latest = (line_start, entry)
        if latest is not None:
            appended = _append_grok_reply(sync, agent, history_path, *latest)
    else:
        for line_start, entry in scan:
            if _append_grok_reply(sync, agent, history_path, line_start, entry):
                appended = True

    advance_read_offset(sync.offsets, history_path, scan.consumed)
    report_skipped_lines(sync, agent, scan)
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


def sync_grok_native_log(
    sync,
    agent: str,
    native_log_path: str | None = None,
    *,
    start_at_end: bool = False,
) -> None:
    updates_path = str(native_log_path or "").strip()
    if not updates_path or not os.path.isfile(updates_path):
        return
    history_path = _chat_history_path(updates_path)
    if not history_path:
        return

    file_size = os.path.getsize(updates_path)
    history_size = os.path.getsize(history_path)
    if start_at_end:
        advance_read_offset(sync.offsets, updates_path, file_size)
        advance_read_offset(sync.offsets, history_path, history_size)
        return
    start = read_offset_start(sync.offsets, updates_path, file_size)

    turn_completed = False
    if start < file_size:
        workspace = sync.workspace
        scan = CompleteJsonlScan(updates_path, start)
        for _line_start, entry in scan:
            turn_completed = _turn_completed(entry) or turn_completed
            tool_evs: list[dict] = []
            for name, inp in iter_tool_calls_from_update(entry):
                tool_evs.extend(running_tool_events(name, inp, workspace=workspace))
            if tool_evs:
                sync.push_running_display(agent, tool_evs)
        advance_read_offset(sync.offsets, updates_path, scan.consumed)
        report_skipped_lines(sync, agent, scan)
    else:
        advance_read_offset(sync.offsets, updates_path, file_size)

    _sync_grok_chat_history(sync, agent, history_path)
    if turn_completed:
        sync.mark_idle(agent)
