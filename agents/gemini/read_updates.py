from __future__ import annotations

import os
import time
from pathlib import Path

from agents.path_state import (
    advance_read_offset,
    read_offset_start,
)
from agents.gemini.read_running import (
    parse_antigravity_transcript_step,
    running_tool_events,
)
from agents.jsonl_read import CompleteJsonlScan, report_skipped_lines
from fs.log.jsonl import append_jsonl_entry


def sync_gemini_native_log(
    sync,
    agent: str,
    native_log_path: str | None = None,
    *,
    start_at_end: bool = False,
) -> None:
    session_path_str = str(native_log_path or "").strip()
    if not session_path_str or not os.path.exists(session_path_str):
        return
    if Path(session_path_str).name != "transcript_full.jsonl":
        raise RuntimeError(f"Antigravity native log is not transcript_full.jsonl: {session_path_str}")

    file_size = os.path.getsize(session_path_str)
    if start_at_end:
        advance_read_offset(sync.offsets, session_path_str, file_size)
        return
    start = read_offset_start(sync.offsets, session_path_str, file_size)
    if start >= file_size:
        return

    scan = CompleteJsonlScan(session_path_str, start)
    appended = False
    for line_start, entry in scan:
        text, tool_calls = parse_antigravity_transcript_step(entry)
        if tool_calls:
            running_events: list[dict] = []
            for tool_name, arguments in tool_calls:
                running_events.extend(
                    running_tool_events(tool_name, arguments, workspace=sync.workspace)
                )
            if running_events:
                sync.push_running_display(agent, running_events)
        if not text:
            continue
        append_jsonl_entry(
            sync.log_path,
            {
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "sender": agent,
                "targets": ["user"],
                "message": text,
                "native_log_kind": "antigravity_assistant_response",
                "native_log_path": session_path_str,
                "native_log_offset": line_start,
            },
        )
        appended = True

    advance_read_offset(sync.offsets, session_path_str, scan.consumed)
    report_skipped_lines(sync, agent, scan)
    if appended:
        sync.mark_idle(agent)
