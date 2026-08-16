from __future__ import annotations

import hashlib
import os
import sqlite3
import threading
import time
from pathlib import Path

from native_log_sync.agents._shared.path_state import (
    _normalized_native_log_path,
    advance_read_progress,
)
from native_log_sync.io.projected import append_projected_entry
from native_log_sync.agents._shared.runtime_push import push_runtime_display
from native_log_sync.agents.gemini.read_runtime import (
    load_antigravity_transcript_entries,
    parse_antigravity_planner_step,
    parse_antigravity_transcript_step,
    runtime_tool_events,
)

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
        sync_gemini_native_log(self, agent, db_path)

    timer = threading.Timer(_ANTIGRAVITY_RETRY_DELAY_SECONDS, retry)
    timer.daemon = True
    timer.start()


def _sync_antigravity_db(self, agent: str, db_path: str) -> bool:
    normalized_path = _normalized_native_log_path(db_path)
    is_continuation = normalized_path in self._native_log_progress
    start_idx = self._native_log_progress.get(normalized_path, 0)
    appended = False
    next_cursor = start_idx
    pending_steps = getattr(self, "_gemini_pending_antigravity_steps", None)
    if not isinstance(pending_steps, dict):
        pending_steps = {}
        self._gemini_pending_antigravity_steps = pending_steps
    pending_prefix = f"{normalized_path}:"
    for key in list(pending_steps):
        if not str(key).startswith(pending_prefix):
            pending_steps.pop(key, None)

    # Track the last step committed while it was still max_idx so we can
    # re-verify its content on the next sync and append a correction if the
    # payload grew after we committed.
    committed_tail = getattr(self, "_gemini_committed_tail", None)
    if not isinstance(committed_tail, dict):
        committed_tail = {}
        self._gemini_committed_tail = committed_tail

    try:
        # A plain read-only connection (no immutable/nolock) correctly
        # respects this WAL-mode database's locking, so concurrent writes
        # from the Antigravity CLI can't be read as a torn/inconsistent
        # page. immutable=1 previously told sqlite to skip that safety
        # check, which could yield a truncated payload that parsed to
        # empty text and got permanently skipped past.
        uri = f"file:{db_path}?mode=ro"
        with sqlite3.connect(uri, uri=True) as conn:
            # Wait briefly instead of failing immediately if the CLI holds
            # a write lock at the exact moment we connect.
            conn.execute("pragma busy_timeout = 2000")
            max_idx = int(conn.execute("select coalesce(max(idx), -1) from steps").fetchone()[0])
            # Include one step before start_idx if we have a committed tail to
            # re-verify, so we can detect payload growth.
            tail_info = committed_tail.get(normalized_path)
            query_start = start_idx
            if tail_info and tail_info["idx"] == start_idx - 1:
                query_start = tail_info["idx"]
            rows = conn.execute(
                """
                select idx, step_payload
                from steps
                where step_type = 15 and idx >= ?
                order by idx
                """,
                (query_start,),
            ).fetchall()
        now = time.monotonic()
        transcript_entries: dict[int, dict] | None = None
        for idx, payload in rows:
            idx = int(idx)

            # Re-verify a previously committed tail step whose payload may have
            # grown since we last saw it.
            if tail_info and idx == tail_info["idx"] and idx < start_idx:
                current_sig = (len(payload or b""), hashlib.sha256(payload or b"").digest())
                if current_sig != tail_info["signature"]:
                    text, tool_calls = parse_antigravity_planner_step(payload or b"")
                    if not text and not tool_calls:
                        if transcript_entries is None:
                            transcript_entries = load_antigravity_transcript_entries(db_path)
                        text, tool_calls = parse_antigravity_transcript_step(transcript_entries.get(idx))
                    text = text.strip()
                    if text:
                        msg_id = f"antigravity-v2:{Path(db_path).stem}:{idx}"
                        jsonl_entry = {
                            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                            "session": self.session_name,
                            "sender": agent,
                            "targets": ["user"],
                            "message": text,
                            "msg_id": msg_id,
                            "native_log_kind": "antigravity_assistant_response",
                            "native_log_path": db_path,
                            "native_log_offset": idx,
                        }
                        append_projected_entry(self.log_path, jsonl_entry)
                        appended = True
                # If this step is no longer max_idx, it's confirmed complete.
                if idx < max_idx:
                    committed_tail.pop(normalized_path, None)
                else:
                    tail_info["signature"] = (len(payload or b""), hashlib.sha256(payload or b"").digest())
                    # Still the last step -- schedule a retry so we keep
                    # re-verifying until the payload truly stops growing.
                    step_key = f"{normalized_path}:{idx}"
                    _schedule_antigravity_retry(self, agent, db_path, step_key)
                continue

            if idx < next_cursor:
                continue
            step_key = f"{normalized_path}:{idx}"
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
            if runtime_events and (is_continuation or idx >= max_idx):
                push_runtime_display(self, agent, runtime_events)

            if not text:
                next_cursor = idx + 1
                continue
            msg_id = f"antigravity-v2:{Path(db_path).stem}:{idx}"
            jsonl_entry = {
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "session": self.session_name,
                "sender": agent,
                "targets": ["user"],
                "message": text,
                "msg_id": msg_id,
                "native_log_kind": "antigravity_assistant_response",
                "native_log_path": db_path,
                "native_log_offset": idx,
            }
            append_projected_entry(self.log_path, jsonl_entry)
            appended = True
            next_cursor = idx + 1

            # If this step is the current tail, record it for re-verification.
            if idx >= max_idx:
                committed_tail[normalized_path] = {
                    "idx": idx,
                    "signature": signature,
                }
            else:
                # A newer step exists -- this step is confirmed complete.
                committed_tail.pop(normalized_path, None)

        advance_read_progress(self._native_log_progress, db_path, next_cursor)
        self.save_sync_state()
        if appended:
            self._mark_idle(agent)
        return appended
    finally:
        # Guarantee forward progress no matter what happened above: a
        # transient sqlite error (e.g. SQLITE_BUSY from the Antigravity
        # CLI holding a write lock at the exact moment we queried) must
        # not permanently orphan an unresolved tail row or pending step.
        # If either tracker still shows unresolved state for this exact
        # path, force a retry -- _schedule_antigravity_retry is a no-op
        # if one is already scheduled, so this is safe to call
        # unconditionally.
        tail_info = committed_tail.get(normalized_path)
        if tail_info:
            _schedule_antigravity_retry(self, agent, db_path, f"{normalized_path}:{tail_info['idx']}")
        for key in list(pending_steps):
            if str(key).startswith(pending_prefix):
                _schedule_antigravity_retry(self, agent, db_path, key)


def sync_gemini_native_log(self, agent: str, native_log_path: str | None = None) -> None:
    session_path_str = str(native_log_path or "").strip()
    if not session_path_str or not os.path.exists(session_path_str):
        return

    if not session_path_str.endswith(".db"):
        raise RuntimeError(f"Antigravity native log is not a db: {session_path_str}")

    self._native_log_current_paths[agent] = session_path_str
    _sync_antigravity_db(self, agent, session_path_str)
