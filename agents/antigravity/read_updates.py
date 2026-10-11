from __future__ import annotations

import os
from pathlib import Path

from agents.read_offset import read_offset_start
from agents.antigravity.read_running import (
    parse_antigravity_transcript_step,
    running_tool_events,
)
from agents.jsonl_read import CompleteJsonlScan, report_skipped_lines


def project_antigravity_native_log(
    projector,
    agent: str,
    path: str,
    *,
    start_at_end: bool = False,
) -> None:
    if not os.path.exists(path):
        return
    if Path(path).name != "transcript_full.jsonl":
        raise RuntimeError(f"Antigravity native log is not transcript_full.jsonl: {path}")

    file_size = os.path.getsize(path)
    if start_at_end:
        projector.offsets[path] = file_size
        return
    start = read_offset_start(projector.offsets, path, file_size)
    if start >= file_size:
        return

    scan = CompleteJsonlScan(path, start)
    appended = False
    for line_start, entry in scan:
        compacted = entry.get("source") == "SYSTEM" and entry.get("type") == "CHECKPOINT" and entry.get("status") == "DONE"
        text, tool_calls = parse_antigravity_transcript_step(entry)
        if compacted:
            text = "Context compacted"
        if tool_calls:
            running_events: list[dict] = []
            for tool_name, arguments in tool_calls:
                running_events.extend(
                    running_tool_events(tool_name, arguments, workspace=projector.workspace)
                )
            if running_events:
                projector.push_running_display(agent, running_events)
        if not text:
            continue
        projector.append_reply(agent, path, line_start, text)
        if not compacted:
            appended = True

    projector.offsets[path] = scan.consumed
    report_skipped_lines(projector, agent, scan)
    if appended:
        projector.mark_idle(agent)
