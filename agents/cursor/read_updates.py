from __future__ import annotations

import os
import re

from agents.read_offset import read_offset_start
from agents.cursor.read_running import iter_tool_calls, running_tool_events
from agents.jsonl_read import CompleteJsonlScan, report_skipped_lines


_CURSOR_INTERNAL_NOTE_RE = re.compile(
    r"(?:^|\n{2,})(?:\*\*)?[A-Z][A-Za-z]+ing[^\n]*(?:\*\*)?\s*\n{2,}",
)


def _cursor_assistant_message_has_no_tool_use(entry: dict) -> bool:
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
        if not _cursor_assistant_message_has_no_tool_use(entry):
            return ""
        msg_obj = entry.get("message")
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
        msg_obj = entry.get("message")
        if isinstance(msg_obj, dict):
            content = msg_obj.get("content", "")
            if isinstance(content, str) and content.strip():
                return content.strip()
        elif isinstance(msg_obj, str) and msg_obj.strip():
            return msg_obj.strip()
        return ""
    return ""


def _cursor_display_for_projection(entry: dict) -> str:
    display = (_extract_cursor_sync_display_text(entry) or "").strip()
    if not display or display == "[REDACTED]":
        return ""
    if display.endswith("[REDACTED]"):
        display = display[: -len("[REDACTED]")].rstrip()
    return display


def project_cursor_native_log(
    projector,
    agent: str,
    path: str,
    *,
    start_at_end: bool = False,
) -> None:
    if not os.path.exists(path):
        return

    file_size = os.path.getsize(path)
    if start_at_end:
        projector.offsets[path] = file_size
        return
    start = read_offset_start(projector.offsets, path, file_size, wait_on_shrink=True)
    if start >= file_size:
        return

    scan = CompleteJsonlScan(path, start)
    batch = list(scan)
    turn_done_seen = _cursor_turn_done_from_batch(batch)

    for line_start, entry in batch:
        display = _cursor_display_for_projection(entry)
        if not display:
            continue

        projector.append_reply(agent, path, line_start, display)

    for _ls, entry in batch:
        tool_evs = []
        for name, inp in iter_tool_calls(entry):
            tool_evs.extend(running_tool_events(name, inp, workspace=projector.workspace))
        if tool_evs:
            projector.push_running_display(agent, tool_evs)

    projector.offsets[path] = scan.consumed
    report_skipped_lines(projector, agent, scan)
    if turn_done_seen:
        projector.mark_idle(agent)
