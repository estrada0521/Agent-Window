from __future__ import annotations

import hashlib
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path

from native_log_sync.agents._shared.path_state import (
    NativeLogCursor,
)
from backend_core.access.files import append_jsonl_entry
from native_log_sync.agents._shared.runtime_push import push_runtime_display
from native_log_sync.agents.gemini.read_runtime import (
    load_antigravity_transcript_entries,
    parse_antigravity_planner_step,
    parse_antigravity_transcript_step,
    runtime_tool_events,
)
from native_log_sync.duplicate import already_synced_message, mark_message_synced

_ANTIGRAVITY_STABLE_SEEN_SECONDS = 1.5
_ANTIGRAVITY_RETRY_DELAY_SECONDS = 1.7


def _schedule_antigravity_retry(self, agent: str, db_path: str, step_key: str) -> None:
    retry_keys = getattr(self, "_gemini_pending_antigravity_retry_keys", None)
    if not isinstance(retry_keys, set):
        retry_keys = set()
        self._gemini_pending_antigravity_retry_keys = retry_keys
    if step_key in retry_keys:
        return
    retry_keys.add(step_key)

    def retry() -> None:
        retry_keys.discard(step_key)
        try:
            sync_gemini_native_log(
                self,
                agent,
                db_path,
                first_seen_grace_seconds=0,
                sync_bind_backfill_window_seconds=0,
            )
        except Exception as exc:
            logging.error(f"Failed to retry Gemini Antigravity sync for {agent}: {exc}", exc_info=True)

    timer = threading.Timer(_ANTIGRAVITY_RETRY_DELAY_SECONDS, retry)
    timer.daemon = True
    timer.start()


def _sync_antigravity_db(self, agent: str, db_path: str, prev_cursor: NativeLogCursor | None) -> bool:
    prev_key = os.path.realpath(prev_cursor.path) if prev_cursor is not None else ""
    current_key = os.path.realpath(db_path)
    same_binding = prev_cursor is not None and prev_key == current_key
    start_idx = int(prev_cursor.offset) if same_binding else 0
    appended = False
    next_cursor = start_idx
    pending_steps = getattr(self, "_gemini_pending_antigravity_steps", None)
    if not isinstance(pending_steps, dict):
        pending_steps = {}
        self._gemini_pending_antigravity_steps = pending_steps
    pending_prefix = f"{current_key}:"
    for key in list(pending_steps):
        if not str(key).startswith(pending_prefix):
            pending_steps.pop(key, None)
    uri = f"file:{db_path}?mode=ro&immutable=1&nolock=1"
    with sqlite3.connect(uri, uri=True) as conn:
        max_idx = int(conn.execute("select coalesce(max(idx), -1) from steps").fetchone()[0])
        rows = conn.execute(
            """
            select idx, step_payload
            from steps
            where step_type = 15 and idx >= ?
            order by idx
            """,
            (start_idx,),
        ).fetchall()
    now = time.monotonic()
    transcript_entries: dict[int, dict] | None = None
    for idx, payload in rows:
        idx = int(idx)
        if idx < next_cursor:
            continue
        step_key = f"{current_key}:{idx}"
        text, tool_calls = parse_antigravity_planner_step(payload or b"")
        if not text and not tool_calls:
            if transcript_entries is None:
                transcript_entries = load_antigravity_transcript_entries(db_path)
            text, tool_calls = parse_antigravity_transcript_step(transcript_entries.get(idx))
        text = text.strip()
        payload_size = len(payload or b"")
        signature = (payload_size, hashlib.sha256(payload or b"").digest())
        pending = pending_steps.get(step_key)
        if idx >= max_idx and (pending is None or pending.get("signature") != signature):
            pending_steps[step_key] = {
                "signature": signature,
                "first_seen": now,
            }
            _schedule_antigravity_retry(self, agent, db_path, step_key)
            break
        if idx >= max_idx and now - float((pending or {}).get("first_seen") or now) < _ANTIGRAVITY_STABLE_SEEN_SECONDS:
            _schedule_antigravity_retry(self, agent, db_path, step_key)
            break
        pending_steps.pop(step_key, None)

        runtime_events: list[dict] = []
        for tool_name, arguments in tool_calls:
            runtime_events.extend(
                runtime_tool_events(tool_name, arguments, workspace=str(self.workspace or ""))
            )
        # Binding a pre-existing conversation can backfill hundreds of rows.
        # Do not replay that historical tool stream into the live status UI.
        if runtime_events and (same_binding or idx >= max_idx):
            push_runtime_display(self, agent, runtime_events)

        if not text:
            next_cursor = idx + 1
            continue
        msg_id = f"antigravity-v2:{Path(db_path).stem}:{idx}"
        if already_synced_message(self, agent, text, msg_id):
            next_cursor = idx + 1
            continue
        jsonl_entry = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "session": self.session_name,
            "sender": agent,
            "targets": ["user"],
            "message": text,
            "msg_id": msg_id,
            "native_log_kind": "antigravity_assistant_response",
        }
        append_jsonl_entry(self.index_path, jsonl_entry)
        mark_message_synced(self, agent, text, msg_id)
        appended = True
        next_cursor = idx + 1
    self._gemini_cursors[agent] = NativeLogCursor(path=db_path, offset=next_cursor)
    self.save_sync_state()
    if appended:
        self._mark_idle(agent)
    return appended


def sync_gemini_native_log(
    self,
    agent: str,
    native_log_path: str | None = None,
    *,
    first_seen_grace_seconds: float,
    sync_bind_backfill_window_seconds: float,
) -> None:
    del first_seen_grace_seconds, sync_bind_backfill_window_seconds
    prev_cursor = self._gemini_cursors.get(agent)
    try:
        session_path_str = str(native_log_path or "").strip()
        if not session_path_str or not os.path.exists(session_path_str):
            return

        if not session_path_str.endswith(".db"):
            return

        _sync_antigravity_db(self, agent, session_path_str, prev_cursor)
    except Exception as exc:
        if prev_cursor is None:
            self._gemini_cursors.pop(agent, None)
        else:
            self._gemini_cursors[agent] = prev_cursor
        logging.error(f"Failed to sync Gemini message for {agent}: {exc}", exc_info=True)
