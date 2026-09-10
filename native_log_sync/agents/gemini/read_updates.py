from __future__ import annotations

import os
import time
from pathlib import Path

from native_log_sync.agents._shared.path_state import (
    advance_read_offset,
    read_offset_start,
)
from native_log_sync.agents._shared.projection_status import record_projection_scan_result
from native_log_sync.agents._shared.runtime_push import push_runtime_display
from native_log_sync.agents.gemini.read_runtime import (
    parse_antigravity_transcript_step,
    runtime_tool_events,
)
from native_log_sync.io.jsonl_read import complete_jsonl_scan
from native_log_sync.io.projected import append_projected_entry


def sync_gemini_native_log(
    self,
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
        advance_read_offset(self._native_log_read_offsets, session_path_str, file_size)
        return
    start = read_offset_start(self._native_log_read_offsets, session_path_str, file_size)
    if start >= file_size:
        return

    scan = complete_jsonl_scan(session_path_str, start, align_mid_line=True)
    appended = False
    for line_start, entry in scan:
        text, tool_calls = parse_antigravity_transcript_step(entry)
        if tool_calls:
            runtime_events: list[dict] = []
            for tool_name, arguments in tool_calls:
                runtime_events.extend(
                    runtime_tool_events(tool_name, arguments, workspace=str(self.workspace or ""))
                )
            if runtime_events:
                push_runtime_display(self, agent, runtime_events)
        if not text:
            continue
        append_projected_entry(
            self.log_path,
            {
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "session": self.session_name,
                "sender": agent,
                "targets": ["user"],
                "message": text,
                "native_log_kind": "antigravity_assistant_response",
                "native_log_path": session_path_str,
                "native_log_offset": line_start,
            },
        )
        appended = True

    advance_read_offset(self._native_log_read_offsets, session_path_str, scan.consumed)
    record_projection_scan_result(self, agent, scan)
    if appended:
        self._mark_idle(agent)
