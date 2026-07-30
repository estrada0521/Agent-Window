from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from pathlib import Path

from native_log_sync.agents._shared.path_state import (
    NativeLogCursor,
    _advance_native_cursor,
    _cursor_binding_changed,
    _parse_iso_timestamp_epoch,
)
from native_log_sync.event_format import _pane_runtime_gemini_with_occurrence_ids
from backend_core.access.files import append_jsonl_entry
from native_log_sync.duplicate import already_synced_message, mark_message_synced

from native_log_sync.agents._shared.runtime_display import runtime_event
from native_log_sync.agents._shared.runtime_paths import display_path
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


def sync_codex_native_log(
    self,
    agent: str,
    native_log_path: str | None = None,
    *,
    sync_bind_backfill_window_seconds: float,
) -> None:
    _SYNC_BIND_BACKFILL_WINDOW_SECONDS = float(sync_bind_backfill_window_seconds)
    try:
        resolved_path = str(native_log_path or "").strip()
        if not resolved_path or not os.path.exists(resolved_path):
            return

        def _append_codex_entry(entry: dict, *, min_event_ts: float | None = None) -> bool:
            if min_event_ts is not None:
                event_ts = _parse_iso_timestamp_epoch(str(entry.get("timestamp") or ""))
                if event_ts is None or event_ts < min_event_ts:
                    return False

            display = ""
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
                else:
                    return False
            else:
                return False

            if not display:
                return False

            src_ts = str(entry.get("timestamp") or "")
            key = f"codex:{agent}:{src_ts}:{display}"
            msg_id = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]
            if already_synced_message(self, agent, display, msg_id):
                return False

            timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            jsonl_entry = {
                "timestamp": timestamp,
                "session": self.session_name,
                "sender": agent,
                "targets": ["user"],
                "message": display,
                "msg_id": msg_id,
            }
            append_jsonl_entry(self.index_path, jsonl_entry)
            mark_message_synced(self, agent, display, msg_id)
            return True

        def _scan_recent_codex_entries(min_event_ts: float) -> bool:
            appended = False
            try:
                with open(resolved_path, "r", encoding="utf-8") as handle:
                    for line in handle:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            entry = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if _append_codex_entry(entry, min_event_ts=min_event_ts):
                            appended = True
            except Exception:
                return False
            return appended

        file_size = os.path.getsize(resolved_path)
        prev_cursor = self._codex_cursors.get(agent)
        offset = _advance_native_cursor(self._codex_cursors, agent, resolved_path, file_size)
        if offset is None:
            if _cursor_binding_changed(prev_cursor, self._codex_cursors.get(agent)):
                path_changed = prev_cursor is not None and prev_cursor.path != resolved_path
                if path_changed:
                    # restart: read entire new file so pong + task_complete are not missed
                    last_runtime_state_event = ""
                    try:
                        with open(resolved_path, "r", encoding="utf-8") as f:
                            for line in f:
                                line = line.strip()
                                if not line:
                                    continue
                                try:
                                    entry = json.loads(line)
                                except json.JSONDecodeError:
                                    continue
                                _append_codex_entry(entry)
                                runtime_state_event = _codex_runtime_state_event(entry)
                                if runtime_state_event:
                                    last_runtime_state_event = runtime_state_event
                                for name, inp in iter_tool_calls(entry):
                                    tool_evs = runtime_tool_events(name, inp, workspace=str(self.workspace or ""))
                                    if tool_evs:
                                        push_runtime_display(self, agent, tool_evs)
                    except Exception:
                        pass
                    self.save_sync_state()
                    if last_runtime_state_event == "completed":
                        self._mark_idle(agent)
                    elif last_runtime_state_event == "active" and agent not in self.running_agents():
                        self._mark_running_from_native_activity(agent)
                else:
                    min_event_ts = time.time() - _SYNC_BIND_BACKFILL_WINDOW_SECONDS
                    if _scan_recent_codex_entries(min_event_ts):
                        self.save_sync_state()
            return

        last_runtime_state_event = ""

        with open(resolved_path, "r", encoding="utf-8") as f:
            f.seek(offset)
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                _append_codex_entry(entry)
                runtime_state_event = _codex_runtime_state_event(entry)
                if runtime_state_event:
                    last_runtime_state_event = runtime_state_event
                tool_evs = []
                for name, inp in iter_tool_calls(entry):
                    tool_evs.extend(runtime_tool_events(name, inp, workspace=str(self.workspace or "")))
                if tool_evs:
                    push_runtime_display(self, agent, tool_evs)

        self._codex_cursors[agent] = NativeLogCursor(path=resolved_path, offset=file_size)
        self.save_sync_state()
        if last_runtime_state_event == "completed":
            self._mark_idle(agent)
        elif last_runtime_state_event == "active" and agent not in self.running_agents():
            self._mark_running_from_native_activity(agent)
    except Exception as exc:
        logging.error(f"Failed to sync Codex message for {agent}: {exc}")
