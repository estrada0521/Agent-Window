from __future__ import annotations

import hashlib
import json
import logging
import os
import time

from native_log_sync.agents._shared.path_state import (
    advance_read_progress,
    read_progress_start,
)
from backend_core.access.files import append_jsonl_entry

from native_log_sync.agents.codex.read_runtime import iter_tool_calls, runtime_tool_events
from native_log_sync.agents._shared.runtime_push import push_runtime_display


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


def _codex_token_count_limit_message(payload: dict) -> str:
    rate_limits = payload.get("rate_limits") or {}
    if not isinstance(rate_limits, dict):
        return ""

    reached_type = str(rate_limits.get("rate_limit_reached_type") or "").strip()
    if not reached_type:
        return ""

    credits = rate_limits.get("credits")
    if isinstance(credits, dict):
        no_credits = not credits.get("has_credits", True) and str(credits.get("balance", "1")) == "0"
        if no_credits:
            return "You've hit your usage limit. Purchase more credits or wait for the next billing cycle."

    primary = rate_limits.get("primary") or {}
    if not isinstance(primary, dict):
        primary = {}
    window = primary.get("window_minutes")
    resets_at = primary.get("resets_at")
    if resets_at:
        import datetime
        reset_str = datetime.datetime.fromtimestamp(resets_at).strftime("%H:%M")
        return f"Rate limit reached. Resets at {reset_str}."
    if window:
        return f"Rate limit reached. Resets in {window} minutes."
    return "Rate limit reached."


def sync_codex_native_log(self, agent: str, native_log_path: str | None = None) -> None:
    try:
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
                                t = c.get("text") or c.get("output_text", {}).get("text", "")
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
                elif payload_type == "agent_reasoning":
                    return False
                elif payload_type == "token_count":
                    display = _codex_token_count_limit_message(payload)
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
            append_jsonl_entry(self.index_path, jsonl_entry)
            return True

        last_runtime_state_event = ""
        with open(resolved_path, "r", encoding="utf-8") as f:
            f.seek(start)
            while True:
                line_start = f.tell()
                line = f.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                _append_codex_entry(entry, line_start)
                runtime_state_event = _codex_runtime_state_event(entry)
                if runtime_state_event:
                    last_runtime_state_event = runtime_state_event
                tool_evs = []
                for name, inp in iter_tool_calls(entry):
                    tool_evs.extend(runtime_tool_events(name, inp, workspace=str(self.workspace or "")))
                if tool_evs:
                    push_runtime_display(self, agent, tool_evs)

        advance_read_progress(self._native_log_progress, resolved_path, file_size)
        self.save_sync_state()
        if last_runtime_state_event == "completed":
            self._mark_idle(agent)
        elif last_runtime_state_event == "active" and agent not in self.running_agents():
            self._mark_running_from_native_activity(agent)
    except Exception as exc:
        logging.error(f"Failed to sync Codex message for {agent}: {exc}")
