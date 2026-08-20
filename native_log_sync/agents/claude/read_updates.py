from __future__ import annotations

import os
import time

from native_log_sync.agents._shared.msg_id import content_msg_id
from native_log_sync.agents._shared.path_state import (
    advance_read_progress,
    read_progress_start,
)
from native_log_sync.agents._shared.projection_status import record_projection_scan_result
from native_log_sync.agents._shared.runtime_push import push_runtime_display
from native_log_sync.agents.claude.read_runtime import iter_tool_calls, runtime_tool_events
from native_log_sync.io.jsonl_read import complete_jsonl_scan
from native_log_sync.io.projected import append_projected_entry


def _claude_entry_marks_turn_done(entry: dict) -> bool:
    if (
        entry.get("type") == "system"
        and entry.get("subtype") == "turn_duration"
        and not entry.get("isSidechain")
    ):
        return True
    if (
        entry.get("type") == "user"
        and not entry.get("isSidechain")
    ):
        msg = entry.get("message")
        if isinstance(msg, dict):
            content = msg.get("content", [])
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get("text") == "[Request interrupted by user]":
                        return True
    if entry.get("type") != "assistant" or entry.get("isSidechain"):
        return False
    msg = entry.get("message")
    if not isinstance(msg, dict):
        return False
    stop_reason = str(msg.get("stop_reason") or "").strip().lower()
    if stop_reason and stop_reason != "tool_use":
        return True
    return bool(entry.get("isApiErrorMessage"))


def _claude_msg_id(entry: dict, session_path: str, line_start: int) -> str:
    native_id = str(entry.get("uuid") or entry.get("id") or "").strip()
    if native_id:
        return native_id[:12]
    return content_msg_id(session_path, line_start)


def sync_claude_native_log(self, agent: str, native_log_path: str | None = None) -> None:
    session_path_str = str(native_log_path or "").strip()
    if not session_path_str or not os.path.exists(session_path_str):
        return

    self._native_log_current_paths[agent] = session_path_str
    file_size = os.path.getsize(session_path_str)
    start = read_progress_start(self._native_log_progress, session_path_str, file_size)
    if start >= file_size:
        return

    def _append_claude_entry(entry: dict, line_start: int) -> bool:
        if entry.get("type") != "assistant":
            return False
        msg = entry.get("message") if isinstance(entry, dict) else {}
        if not isinstance(msg, dict):
            return False

        content = msg.get("content", [])
        if not isinstance(content, list):
            return False
        texts = []
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                text = str(c.get("text") or "").strip()
                if text:
                    texts.append(text)
        if not texts:
            return False
        display = "\n".join(texts)
        jsonl_entry = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "session": self.session_name,
            "sender": agent,
            "targets": ["user"],
            "message": display,
            "msg_id": _claude_msg_id(entry, session_path_str, line_start),
            "native_log_path": session_path_str,
            "native_log_offset": line_start,
        }
        if entry.get("isApiErrorMessage"):
            jsonl_entry["kind"] = "provider-notice"
        append_projected_entry(self.log_path, jsonl_entry)
        return True

    turn_done_seen = False
    scan = complete_jsonl_scan(session_path_str, start)
    for line_start, entry in scan:
        if _claude_entry_marks_turn_done(entry):
            turn_done_seen = True
        _append_claude_entry(entry, line_start)
        tool_evs = []
        for name, inp in iter_tool_calls(entry):
            tool_evs.extend(runtime_tool_events(name, inp, workspace=str(self.workspace or "")))
        if tool_evs:
            push_runtime_display(self, agent, tool_evs)

    advance_read_progress(self._native_log_progress, session_path_str, scan.consumed)
    record_projection_scan_result(self, agent, scan)
    self.save_sync_state()
    if turn_done_seen:
        self._mark_idle(agent)
