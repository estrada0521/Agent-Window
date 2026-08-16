from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time

from native_log_sync.agents._shared.path_state import (
    _normalized_native_log_path,
    advance_read_progress,
    read_progress_start,
)
from backend_core.access.files import append_jsonl_entry
from native_log_sync.redacted import normalize_cursor_plaintext_for_index
from native_log_sync.agents.cursor.read_runtime import iter_tool_calls, runtime_tool_events
from native_log_sync.agents._shared.runtime_push import push_runtime_display


_CURSOR_INTERNAL_NOTE_RE = re.compile(
    r"(?:^|\n{2,})(?:\*\*)?[A-Z][A-Za-z]+ing[^\n]*(?:\*\*)?\s*\n{2,}",
)


def _cursor_assistant_message_has_no_tool_use(entry: dict) -> bool:
    """True when this line is an assistant message whose content blocks include no tool_use."""
    if entry.get("role") != "assistant":
        return False
    msg = entry.get("message")
    if not isinstance(msg, dict):
        return False
    content = msg.get("content")
    if isinstance(content, list):
        return not any(isinstance(c, dict) and c.get("type") == "tool_use" for c in content)
    if isinstance(content, str):
        return True
    return False


def _cursor_turn_done_from_batch(batch: list[tuple[int, dict]]) -> bool:
    return any(_cursor_assistant_message_has_no_tool_use(entry) for _ls, entry in batch)


def _strip_cursor_internal_notes(text: str) -> str:
    body = str(text or "").strip()
    if not body:
        return ""
    match = _CURSOR_INTERNAL_NOTE_RE.search(body)
    if not match:
        return body
    return body[: match.start()].rstrip()


def _extract_cursor_sync_display_text(entry: dict) -> str:
    role = entry.get("role", "")
    if role == "assistant":
        # A text block alongside a tool_use is mid-turn narration/reasoning,
        # not a message to the user; only a turn with no further tool calls
        # is an actual reply.
        if not _cursor_assistant_message_has_no_tool_use(entry):
            return ""
        msg_obj = entry.get("message") if isinstance(entry, dict) else {}
        if not isinstance(msg_obj, dict):
            return ""
        content = msg_obj.get("content", [])
        if isinstance(content, str) and content.strip():
            return _strip_cursor_internal_notes(content)
        if isinstance(content, list):
            texts: list[str] = []
            for c in content:
                if isinstance(c, dict) and c.get("type") == "text":
                    text = _strip_cursor_internal_notes(str(c.get("text") or ""))
                    if text:
                        texts.append(text)
            if not texts:
                return ""
            return "\n".join(texts)
        return ""
    if role == "system":
        msg_obj = entry.get("message") if isinstance(entry, dict) else {}
        if isinstance(msg_obj, dict):
            content = msg_obj.get("content", "")
            if isinstance(content, str) and content.strip():
                return content.strip()
        elif isinstance(msg_obj, str) and msg_obj.strip():
            return msg_obj.strip()
        return ""
    return ""


def _cursor_display_for_sync(entry: dict) -> str:
    display = _extract_cursor_sync_display_text(entry)
    if not display:
        return ""
    return normalize_cursor_plaintext_for_index(display) or ""


def last_synced_cursor_display(log_path: str, transcript_path: str) -> str | None:
    key = _normalized_native_log_path(transcript_path)
    if not key or not os.path.exists(log_path):
        return None
    last: str | None = None
    with open(log_path, "r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            path = entry.get("native_log_path")
            if not isinstance(path, str) or _normalized_native_log_path(path) != key:
                continue
            message = entry.get("message")
            if isinstance(message, str) and message:
                last = message
    return last


def resume_offset_after_display(transcript_path: str, display: str) -> int | None:
    if not display:
        return None
    with open(transcript_path, "r", encoding="utf-8") as handle:
        while True:
            line = handle.readline()
            if not line:
                return None
            stripped = line.strip()
            if not stripped:
                continue
            try:
                entry = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if _cursor_display_for_sync(entry) == display:
                return handle.tell()


def _read_cursor_transcript_batch(transcript_path: str, start: int) -> tuple[list[tuple[int, dict]], int]:
    """Read complete JSONL rows from `start`. If `start` is mid-line (Cursor
    extended the last row after we snapshotted file size), skip to the next
    newline instead of decoding from the middle of a UTF-8 character.
    Incomplete trailing rows are left unread so the next sync can pick them up.
    """
    batch: list[tuple[int, dict]] = []
    with open(transcript_path, "rb") as handle:
        if start > 0:
            handle.seek(max(start - 1, 0))
            prev = handle.read(1)
            if prev != b"\n":
                handle.readline()
        consumed = handle.tell()
        while True:
            line_start = handle.tell()
            raw = handle.readline()
            if not raw:
                break
            if not raw.endswith(b"\n"):
                break
            try:
                line = raw.decode("utf-8").strip()
            except UnicodeDecodeError:
                consumed = handle.tell()
                continue
            if not line:
                consumed = handle.tell()
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                consumed = handle.tell()
                continue
            batch.append((line_start, entry))
            consumed = handle.tell()
    return batch, consumed


def sync_cursor_native_log(self, agent: str, native_log_path: str | None = None) -> None:
    try:
        transcript_path = str(native_log_path or "").strip()
        if not transcript_path or not os.path.exists(transcript_path):
            return

        self._native_log_current_paths[agent] = transcript_path
        file_size = os.path.getsize(transcript_path)
        start = read_progress_start(self._native_log_progress, transcript_path, file_size)
        if start is None:
            anchor = last_synced_cursor_display(str(self.log_path), transcript_path)
            if not anchor:
                logging.error(
                    "Cursor native log %s shrank below the synced position; no last synced message",
                    transcript_path,
                )
                return
            start = resume_offset_after_display(transcript_path, anchor)
            if start is None:
                logging.error(
                    "Cursor native log %s shrank below the synced position; last synced message not found",
                    transcript_path,
                )
                return
        if start >= file_size:
            return

        batch, consumed = _read_cursor_transcript_batch(transcript_path, start)
        turn_done_seen = _cursor_turn_done_from_batch(batch)

        for line_start, entry in batch:
            display = _cursor_display_for_sync(entry)
            if not display:
                continue

            key = f"cursor:{agent}:{transcript_path}:{line_start}:{display}"
            msg_id = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            jsonl_entry = {
                "timestamp": timestamp,
                "session": self.session_name,
                "sender": agent,
                "targets": ["user"],
                "message": display,
                "msg_id": msg_id,
                "native_log_path": transcript_path,
                "native_log_offset": line_start,
            }
            append_jsonl_entry(self.log_path, jsonl_entry)

        for _ls, entry in batch:
            tool_evs = []
            for name, inp in iter_tool_calls(entry):
                tool_evs.extend(runtime_tool_events(name, inp, workspace=str(self.workspace or "")))
            if tool_evs:
                push_runtime_display(self, agent, tool_evs)

        if turn_done_seen:
            self._mark_idle(agent)

        advance_read_progress(self._native_log_progress, transcript_path, consumed)
        self.save_sync_state()
    except Exception as exc:
        logging.error("Failed to sync Cursor message for %s: %s", agent, exc)
