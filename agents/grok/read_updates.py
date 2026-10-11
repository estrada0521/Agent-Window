from __future__ import annotations

import os
from pathlib import Path

from agents.read_offset import read_offset_start
from agents.grok.read_running import (
    iter_tool_calls_from_update,
    running_tool_events,
    update_payload,
)
from agents.jsonl_read import CompleteJsonlScan, report_skipped_lines


def _grok_assistant_text(entry: dict) -> str:
    if entry.get("type") != "assistant":
        return ""
    content = entry.get("content")
    return content.strip() if isinstance(content, str) else ""


def _sync_grok_chat_history(projector, agent: str, history_path: str) -> None:
    file_size = os.path.getsize(history_path)
    start = read_offset_start(projector.offsets, history_path, file_size)
    if start >= file_size:
        return
    scan = CompleteJsonlScan(history_path, start)
    for line_start, entry in scan:
        display = _grok_assistant_text(entry)
        if display:
            projector.append_reply(agent, history_path, line_start, display)
    projector.offsets[history_path] = scan.consumed
    report_skipped_lines(projector, agent, scan)


def _turn_completed(entry: dict) -> bool:
    update = update_payload(entry)
    return (
        update is not None
        and update.get("sessionUpdate") == "turn_completed"
        and update.get("stop_reason") == "end_turn"
    )


def _chat_history_path(updates_path: str) -> str:
    candidate = Path(updates_path).with_name("chat_history.jsonl")
    return str(candidate) if candidate.is_file() else ""


def project_grok_native_log(
    projector,
    agent: str,
    updates_path: str,
    *,
    start_at_end: bool = False,
) -> None:
    if not os.path.isfile(updates_path):
        return
    history_path = _chat_history_path(updates_path)
    if not history_path:
        return

    file_size = os.path.getsize(updates_path)
    history_size = os.path.getsize(history_path)
    if start_at_end:
        projector.offsets[updates_path] = file_size
        projector.offsets[history_path] = history_size
        return
    start = read_offset_start(projector.offsets, updates_path, file_size)

    turn_completed = False
    if start < file_size:
        workspace = projector.workspace
        scan = CompleteJsonlScan(updates_path, start)
        for _line_start, entry in scan:
            turn_completed = _turn_completed(entry) or turn_completed
            tool_evs: list[dict] = []
            for name, inp in iter_tool_calls_from_update(entry):
                tool_evs.extend(running_tool_events(name, inp, workspace=workspace))
            if tool_evs:
                projector.push_running_display(agent, tool_evs)
        projector.offsets[updates_path] = scan.consumed
        report_skipped_lines(projector, agent, scan)

    _sync_grok_chat_history(projector, agent, history_path)
    if turn_completed:
        projector.mark_idle(agent)
