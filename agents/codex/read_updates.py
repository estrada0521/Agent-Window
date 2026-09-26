from __future__ import annotations

import json
import os
import re
import time

from agents.path_state import (
    advance_read_offset,
    read_offset_start,
)
from agents.running_push import push_running_display
from agents.codex.read_running import iter_tool_calls, running_tool_events
from agents.jsonl_read import CompleteJsonlScan, report_skipped_lines
from fs.log.jsonl import append_jsonl_entry


_CODEX_MEMORY_CITATION_SUFFIX = re.compile(
    r"\s*<oai-mem-citation>\s*<citation_entries>.*?</citation_entries>"
    r"\s*<rollout_ids>.*?</rollout_ids>\s*</oai-mem-citation>\s*\Z",
    re.DOTALL,
)


def _without_codex_memory_citation(text: str) -> str:
    return _CODEX_MEMORY_CITATION_SUFFIX.sub("", text).strip()


def _codex_runtime_state_event(entry: object) -> str:
    if not isinstance(entry, dict):
        return ""
    entry_type = entry.get("type")
    payload = entry.get("payload")
    if not isinstance(payload, dict):
        return ""
    event_type = str(payload.get("type") or "").strip().lower()
    if entry_type == "event_msg":
        if event_type in {"task_complete", "turn_aborted"}:
            return "completed"
        if event_type in {"task_started", "agent_message"}:
            return "active"
    elif entry_type == "response_item" and event_type in {
        "message",
        "function_call",
        "custom_tool_call",
        "web_search_call",
        "tool_search_call",
    }:
        return "active"
    return ""


def _codex_task_error_message(payload: dict) -> str:
    error = payload.get("error")
    if not isinstance(error, dict):
        return ""
    message = str(error.get("message") or "").strip()
    if not message:
        return ""
    if message.startswith("{"):
        try:
            parsed = json.loads(message)
        except (json.JSONDecodeError, TypeError):
            parsed = None
        if isinstance(parsed, dict):
            inner = parsed.get("error")
            if isinstance(inner, dict):
                inner_message = str(inner.get("message") or "").strip()
                if inner_message:
                    return inner_message
    return message


def sync_codex_native_log(
    self,
    agent: str,
    native_log_path: str | None = None,
    *,
    start_at_end: bool = False,
) -> None:
    resolved_path = str(native_log_path or "").strip()
    if not resolved_path or not os.path.exists(resolved_path):
        return

    file_size = os.path.getsize(resolved_path)
    if start_at_end:
        advance_read_offset(self._native_log_read_offsets, resolved_path, file_size)
        return
    start = read_offset_start(self._native_log_read_offsets, resolved_path, file_size)
    if start >= file_size:
        return

    def _append_codex_entry(entry: dict, line_start: int) -> bool:
        display = ""
        idle_after = False
        entry_type = entry.get("type", "")
        if entry_type == "response_item":
            payload = entry.get("payload", {})
            payload_type = str(payload.get("type") or "").strip().lower()
            if payload_type == "reasoning":
                return False
            else:
                if payload.get("role") != "assistant":
                    return False
                content = payload.get("content", [])
                texts = []
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict):
                            t = c.get("text")
                            if t and str(t).strip():
                                texts.append(str(t).strip())
                if not texts:
                    return False
                display = _without_codex_memory_citation("\n".join(texts))
        elif entry_type == "event_msg":
            payload = entry.get("payload", {})
            payload_type = str(payload.get("type") or "").strip().lower()
            if payload_type == "error":
                display = str(payload.get("message") or "").strip()
                idle_after = True
            elif payload_type == "agent_reasoning":
                return False
            elif payload_type == "task_complete":
                display = _codex_task_error_message(payload)
                if not display:
                    return False
                idle_after = True
            else:
                return False
        else:
            return False

        if not display:
            return False

        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        jsonl_entry = {
            "timestamp": timestamp,
            "sender": agent,
            "targets": ["user"],
            "message": display,
            "native_log_path": resolved_path,
            "native_log_offset": line_start,
        }
        append_jsonl_entry(self.log_path, jsonl_entry)
        if idle_after:
            self._mark_idle(agent)
        return True

    last_runtime_state_event = ""
    scan = CompleteJsonlScan(resolved_path, start)
    for line_start, entry in scan:
        _append_codex_entry(entry, line_start)
        runtime_state_event = _codex_runtime_state_event(entry)
        if runtime_state_event:
            last_runtime_state_event = runtime_state_event
        tool_evs = []
        for name, inp in iter_tool_calls(entry):
            tool_evs.extend(running_tool_events(name, inp, workspace=str(self.workspace or "")))
        if tool_evs:
            push_running_display(self, agent, tool_evs)

    advance_read_offset(self._native_log_read_offsets, resolved_path, scan.consumed)
    report_skipped_lines(self, agent, scan)
    if last_runtime_state_event == "completed":
        self._mark_idle(agent)
    elif last_runtime_state_event == "active" and agent not in self._agent_running:
        self._mark_running_from_native_activity(agent)
