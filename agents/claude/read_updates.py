from __future__ import annotations

import os

from agents.read_offset import read_offset_start
from agents.claude.read_running import iter_tool_calls, running_tool_events
from agents.jsonl_read import CompleteJsonlScan, report_skipped_lines


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


def project_claude_native_log(
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
    start = read_offset_start(projector.offsets, path, file_size)
    if start >= file_size:
        return

    def _append_claude_entry(entry: dict, line_start: int) -> None:
        if entry.get("type") == "system" and entry.get("subtype") == "compact_boundary" and not entry.get("isSidechain"):
            trigger = entry.get("compactMetadata", {}).get("trigger")
            display = "Context compacted"
            if trigger in ("auto", "manual"):
                display += f" ({trigger})"
        else:
            if entry.get("type") != "assistant":
                return
            msg = entry.get("message")
            if not isinstance(msg, dict):
                return

            content = msg.get("content", [])
            if not isinstance(content, list):
                return
            texts = []
            for c in content:
                if isinstance(c, dict) and c.get("type") in ("text", "thinking"):
                    text = str(c.get(c["type"]) or "").strip()
                    if text:
                        texts.append(text)
            if not texts:
                return
            display = "\n".join(texts)
        projector.append_reply(agent, path, line_start, display)

    turn_done_seen = False
    scan = CompleteJsonlScan(path, start)
    for line_start, entry in scan:
        if _claude_entry_marks_turn_done(entry):
            turn_done_seen = True
        _append_claude_entry(entry, line_start)
        tool_evs = []
        for name, inp in iter_tool_calls(entry):
            tool_evs.extend(running_tool_events(name, inp, workspace=projector.workspace))
        if tool_evs:
            projector.push_running_display(agent, tool_evs)

    projector.offsets[path] = scan.consumed
    report_skipped_lines(projector, agent, scan)
    if turn_done_seen:
        projector.mark_idle(agent)
