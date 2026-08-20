from __future__ import annotations

import os
import time
from pathlib import Path

from native_log_sync.agents._shared.msg_id import content_msg_id
from native_log_sync.agents._shared.path_state import (
    advance_read_progress,
    read_progress_start,
)
from native_log_sync.agents._shared.projection_status import record_projection_scan_result
from native_log_sync.agents._shared.runtime_push import push_runtime_display
from native_log_sync.agents.gemini.read_runtime import (
    parse_antigravity_transcript_step,
    runtime_tool_events,
)
from native_log_sync.io.jsonl_read import complete_jsonl_scan
from native_log_sync.io.projected import append_projected_entry


def _conversation_id_from_transcript(path: str) -> str:
    return Path(path).parent.parent.parent.name


def sync_gemini_native_log(self, agent: str, native_log_path: str | None = None) -> None:
    session_path_str = str(native_log_path or "").strip()
    if not session_path_str or not os.path.exists(session_path_str):
        return
    if Path(session_path_str).name != "transcript_full.jsonl":
        raise RuntimeError(f"Antigravity native log is not transcript_full.jsonl: {session_path_str}")

    self._native_log_current_paths[agent] = session_path_str
    file_size = os.path.getsize(session_path_str)
    start = read_progress_start(self._native_log_progress, session_path_str, file_size)
    if start >= file_size:
        return

    scan = complete_jsonl_scan(session_path_str, start)
    appended = False
    conversation_id = _conversation_id_from_transcript(session_path_str)
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
        step_index = entry.get("step_index")
        step_key = step_index if isinstance(step_index, int) else line_start
        msg_id = content_msg_id("antigravity-v2", conversation_id, step_key)
        append_projected_entry(
            self.log_path,
            {
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "session": self.session_name,
                "sender": agent,
                "targets": ["user"],
                "message": text,
                "msg_id": msg_id,
                "native_log_kind": "antigravity_assistant_response",
                "native_log_path": session_path_str,
                "native_log_offset": line_start,
            },
        )
        appended = True

    advance_read_progress(self._native_log_progress, session_path_str, scan.consumed)
    record_projection_scan_result(self, agent, scan)
    self.save_sync_state()
    if appended:
        self._mark_idle(agent)
