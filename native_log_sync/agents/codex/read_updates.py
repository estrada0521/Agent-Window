from __future__ import annotations

import hashlib
import json
import os
import time

from native_log_sync.agents._shared.path_state import (
    advance_read_progress,
    read_progress_start,
)
from native_log_sync.agents._shared.projection_status import record_projection_scan_result
from native_log_sync.agents._shared.runtime_push import push_runtime_display
from native_log_sync.agents.codex.read_runtime import iter_tool_calls, runtime_tool_events
from native_log_sync.io.jsonl_read import complete_jsonl_scan
from native_log_sync.io.projected import append_projected_entry


def _codex_runtime_state_event(entry: object) -> str:
    """Return the last-write-wins runtime state implied by a Codex log entry.

    This deliberately excludes bookkeeping, reasoning, token counts, and tool
    outputs.  They can trail a completed turn without meaning that Codex has
    resumed work.
    """
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
    """Extract a human-readable error from a Codex task_complete event.

    Codex reports a failed turn (rate limit, unsupported model, etc.) by
    setting `error` on the task_complete event, not as a separate `error`
    event_msg. `usage_limit_exceeded` carries an already human-readable
    message; other error kinds carry a raw JSON-encoded API error string,
    so the inner message is unwrapped when present.
    """
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


def sync_codex_native_log(self, agent: str, native_log_path: str | None = None) -> None:
    resolved_path = str(native_log_path or "").strip()
    if not resolved_path or not os.path.exists(resolved_path):
        return

    self._native_log_current_paths[agent] = resolved_path
    file_size = os.path.getsize(resolved_path)
    start = read_progress_start(self._native_log_progress, resolved_path, file_size)
    if start >= file_size:
        return

    def _append_codex_entry(entry: dict, line_start: int) -> bool:
        display = ""
        provider_notice = False
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
                display = "\n".join(texts)
        elif entry_type == "event_msg":
            payload = entry.get("payload", {})
            payload_type = str(payload.get("type") or "").strip().lower()
            if payload_type == "error":
                display = str(payload.get("message") or "").strip()
                provider_notice = True
            elif payload_type == "agent_reasoning":
                return False
            elif payload_type == "task_complete":
                display = _codex_task_error_message(payload)
                if not display:
                    return False
                provider_notice = True
            else:
                return False
        else:
            return False

        if not display:
            return False

        src_ts = str(entry.get("timestamp") or "")
        key = f"codex:{agent}:{src_ts}:{display}"
        msg_id = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]

        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        jsonl_entry = {
            "timestamp": timestamp,
            "session": self.session_name,
            "sender": agent,
            "targets": ["user"],
            "message": display,
            "msg_id": msg_id,
            "native_log_path": resolved_path,
            "native_log_offset": line_start,
        }
        if provider_notice:
            jsonl_entry["kind"] = "provider-notice"
        append_projected_entry(self.log_path, jsonl_entry)
        return True

    last_runtime_state_event = ""
    scan = complete_jsonl_scan(resolved_path, start)
    for line_start, entry in scan:
        _append_codex_entry(entry, line_start)
        runtime_state_event = _codex_runtime_state_event(entry)
        if runtime_state_event:
            last_runtime_state_event = runtime_state_event
        tool_evs = []
        for name, inp in iter_tool_calls(entry):
            tool_evs.extend(runtime_tool_events(name, inp, workspace=str(self.workspace or "")))
        if tool_evs:
            push_runtime_display(self, agent, tool_evs)

    advance_read_progress(self._native_log_progress, resolved_path, scan.consumed)
    record_projection_scan_result(self, agent, scan)
    self.save_sync_state()
    if last_runtime_state_event == "completed":
        self._mark_idle(agent)
    elif last_runtime_state_event == "active" and agent not in self.running_agents():
        self._mark_running_from_native_activity(agent)
