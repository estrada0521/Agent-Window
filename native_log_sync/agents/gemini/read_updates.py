from __future__ import annotations

import logging
import os
import sqlite3
import string
import threading
import time
from pathlib import Path

from native_log_sync.agents._shared.path_state import (
    NativeLogCursor,
)
from backend_core.access.files import append_jsonl_entry
from native_log_sync.duplicate import already_synced_message, mark_message_synced
from native_log_sync.entry_kind import should_omit_antigravity_text

_ANTIGRAVITY_STABLE_SEEN_SECONDS = 1.5
_ANTIGRAVITY_RETRY_DELAY_SECONDS = 1.7


def _read_varint(data: bytes, index: int, end: int) -> tuple[int | None, int]:
    shift = 0
    value = 0
    while index < end and shift < 70:
        byte = data[index]
        index += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, index
        shift += 7
    return None, index


def _printable_utf8(raw: bytes) -> str | None:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if not text.strip():
        return None
    good = sum((ch in string.printable or ord(ch) > 127) and ch not in "\x0b\x0c" for ch in text)
    if good / max(1, len(text)) < 0.85:
        return None
    return text


def _protobuf_strings(data: bytes, *, depth: int = 0, max_depth: int = 4) -> list[str]:
    out: list[str] = []
    index = 0
    end = len(data)
    while index < end:
        key, next_index = _read_varint(data, index, end)
        if key is None or next_index <= index:
            break
        wire = key & 7
        index = next_index
        if wire == 0:
            _, index = _read_varint(data, index, end)
        elif wire == 1:
            index += 8
        elif wire == 5:
            index += 4
        elif wire == 2:
            length, next_index = _read_varint(data, index, end)
            if length is None:
                break
            index = next_index
            if length < 0 or index + length > end:
                break
            chunk = data[index : index + length]
            text = _printable_utf8(chunk)
            if text is not None:
                out.append(text)
            if depth < max_depth and len(chunk) > 1:
                out.extend(_protobuf_strings(chunk, depth=depth + 1, max_depth=max_depth))
            index += length
        else:
            break
    return out


def _antigravity_response_text(payload: bytes) -> str:
    strings = [
        s.strip()
        for s in _protobuf_strings(payload or b"")
        if s.strip() and not should_omit_antigravity_text(s)
    ]
    repeated: dict[str, int] = {}
    for text in strings:
        repeated[text] = repeated.get(text, 0) + 1
    visible_text_candidates = [text for text, count in repeated.items() if count >= 2]
    if visible_text_candidates:
        visible_text_candidates.sort(key=lambda s: (len(s), s), reverse=True)
        return visible_text_candidates[0]

    candidates = [
        s for s in strings
        if "**Summary of work:**" in s or "\n- Received " in s or "pong" in s.lower()
    ]
    if not candidates:
        candidates = [
            s for s in strings
            if 1 <= len(s) <= 8000
            and not s.startswith(("sessionID", "file://", "command(", "read_url("))
            and not s.startswith(("/", "MODEL_", "gemini-"))
            and "trajectory_id" not in s
            and not (len(s) == 36 and s.count("-") == 4)
        ]
    if not candidates:
        return ""
    candidates.sort(key=lambda s: (len(s), s), reverse=True)
    return candidates[0]


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
    start_idx = int(prev_cursor.offset) if prev_cursor is not None and prev_key == current_key else 0
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
        rows = conn.execute(
            """
            select s.idx, s.step_payload, next.step_type
            from steps s
            left join steps next on next.idx = s.idx + 1
            where s.step_type = 15 and s.idx >= ?
            order by s.idx
            """,
            (start_idx,),
        ).fetchall()
    now = time.monotonic()
    for idx, payload, next_step_type in rows:
        idx = int(idx)
        if idx < next_cursor:
            continue
        step_key = f"{current_key}:{idx}"
        if next_step_type in {7, 8, 9}:
            pending_steps.pop(step_key, None)
            next_cursor = idx + 1
            continue
        text = _antigravity_response_text(payload or b"").strip()
        payload_size = len(payload or b"")
        pending = pending_steps.get(step_key)
        if pending is None or pending.get("text") != text or pending.get("payload_size") != payload_size:
            pending_steps[step_key] = {
                "text": text,
                "payload_size": payload_size,
                "first_seen": now,
            }
            _schedule_antigravity_retry(self, agent, db_path, step_key)
            break
        if now - float(pending.get("first_seen") or now) < _ANTIGRAVITY_STABLE_SEEN_SECONDS:
            _schedule_antigravity_retry(self, agent, db_path, step_key)
            break
        pending_steps.pop(step_key, None)
        if not text:
            next_cursor = idx + 1
            continue
        if should_omit_antigravity_text(text):
            next_cursor = idx + 1
            continue
        msg_id = f"antigravity:{Path(db_path).stem}:{idx}"
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
