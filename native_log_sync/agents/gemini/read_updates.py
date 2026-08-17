from __future__ import annotations

import os
import time
from pathlib import Path

from native_log_sync.agents._shared.path_state import (
    _normalized_native_log_path,
    advance_read_progress,
)
from native_log_sync.agents._shared.runtime_push import push_runtime_display
from native_log_sync.agents.gemini.read_runtime import (
    parse_antigravity_transcript_step,
    runtime_tool_events,
)
from native_log_sync.io.jsonl_read import complete_jsonl_scan
from native_log_sync.io.projected import append_projected_entry


def _conversation_id_from_transcript(path: str) -> str:
    return Path(path).parent.parent.parent.name


def _skip_existing_transcript(path: str) -> int:
    scan = complete_jsonl_scan(path, 0)
    for _line_start, _entry in scan:
        pass
    return scan.consumed


def sync_gemini_native_log(self, agent: str, native_log_path: str | None = None) -> None:
    session_path_str = str(native_log_path or "").strip()
    if not session_path_str or not os.path.exists(session_path_str):
        return
    if Path(session_path_str).name != "transcript_full.jsonl":
        raise RuntimeError(f"Antigravity native log is not transcript_full.jsonl: {session_path_str}")

    self._native_log_current_paths[agent] = session_path_str
    key = _normalized_native_log_path(session_path_str)
    file_size = os.path.getsize(session_path_str)
    recorded = self._native_log_progress.get(key)
    if recorded is None or file_size < recorded:
        advance_read_progress(self._native_log_progress, session_path_str, _skip_existing_transcript(session_path_str))
        self.save_sync_state()
        return

    scan = complete_jsonl_scan(session_path_str, recorded)
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
        msg_id = (
            f"antigravity-v2:{conversation_id}:{step_index}"
            if isinstance(step_index, int)
            else f"antigravity-v2:{conversation_id}:{line_start}"
        )
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
    self.save_sync_state()
    if appended:
        self._mark_idle(agent)
