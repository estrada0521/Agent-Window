from __future__ import annotations

import json
import logging
import os
import re
import shlex
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

from native_log_sync.agents._shared.runtime_display import runtime_event
from native_log_sync.agents._shared.runtime_paths import display_path

QUIET: frozenset[str] = frozenset({"write_stdin"})
MAIN_LABEL: dict[str, str] = {
    "apply_patch": "Edit",
    "view_image": "Read",
    "list_mcp_resources": "MCP",
    "spawn_agent": "Agent",
    "update_plan": "Plan",
    "send_input": "Input",
    "wait_agent": "Wait",
    "close_agent": "Close",
}


def _coerce_args(arguments: object) -> object:
    if not isinstance(arguments, str):
        return arguments
    t = arguments.strip()
    if not t or not t.startswith("{"):
        return t
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        return t

_PATCH = re.compile(r"^\*\*\* (?:Add|Update|Delete) File:\s*(.+)\s*$", re.MULTILINE)


def _patch_target_path(arg: object) -> str:
    text = arg if isinstance(arg, str) else ""
    if isinstance(arg, dict):
        for k in ("input", "patch", "content", "text"):
            v = arg.get(k)
            if isinstance(v, str) and v.strip():
                text = v
                break
    m = _PATCH.search(text)
    return m.group(1).strip() if m else "(patch)"


def _pick(d: object, *keys: str) -> str:
    if not isinstance(d, dict):
        return ""
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _truncate_line(value: str, limit: int = 120) -> str:
    line = str(value or "").split("\n", 1)[0].strip()
    return line[: limit - 3] + "..." if len(line) > limit else line


def _split_command(line: str) -> list[str]:
    try:
        return shlex.split(line)
    except ValueError:
        return line.split()


def _first_path_arg(tokens: list[str], *, workspace: str) -> str:
    for token in reversed(tokens[1:]):
        if not token or token.startswith("-"):
            continue
        if token in {"|", "&&", "||", ";"}:
            continue
        return display_path(token, workspace=workspace)
    return ""


def _exec_command_event(args: object, *, workspace: str) -> tuple[str, str] | None:
    if not isinstance(args, dict):
        return None
    cmd = str(args.get("cmd") or args.get("command") or "").strip()
    if not cmd:
        return None
    line = cmd.split("\n", 1)[0].strip()
    tokens = _split_command(line)
    if not tokens:
        return None
    base = os.path.basename(tokens[0])
    lower = base.lower()
    ws = str(workspace or "")

    if lower in {"sed", "cat", "head", "tail", "nl", "xxd", "strings", "file", "wc"}:
        return "Read", _first_path_arg(tokens, workspace=ws) or _truncate_line(line)

    if lower in {"ls", "find", "pwd", "mdfind"}:
        return "Explore", _truncate_line(line)

    if lower == "rg":
        query = ""
        for token in tokens[1:]:
            if token.startswith("-"):
                continue
            query = token
            break
        return "Search", _truncate_line(query or line)

    if lower == "git":
        return "Git", _truncate_line(" ".join(tokens[1:]) or line)

    if lower in {"node", "npm", "npx", "python", "python3", "perl"}:
        if len(tokens) > 1 and tokens[1] in {"--check", "-m", "-c"}:
            return "Check", _truncate_line(line)
        return "Run", _truncate_line(line)

    if lower in {"curl"}:
        return "Fetch", _truncate_line(line)

    if lower in {"ps", "pgrep", "lsof", "kill", "pkill"}:
        return "Process", _truncate_line(line)

    if lower in {"tmux"}:
        return "Tmux", _truncate_line(" ".join(tokens[1:]) or line)

    if lower in {"open", "osascript"}:
        return "App", _truncate_line(line)

    if lower in {"ditto", "rm", "cp", "mv", "mkdir", "install", "chmod"}:
        return "File", _truncate_line(line)

    if lower in {"cargo", "tauri-build", "tauri_start"} or lower.endswith("tauri-build"):
        return "Build", _truncate_line(line)

    return "Shell", _truncate_line(line)


def _codex_subline(tool_lower: str, args: object, *, workspace: str) -> str:
    ws = str(workspace or "")

    if tool_lower == "apply_patch":
        return _patch_target_path(args)

    if not isinstance(args, dict):
        return ""

    if tool_lower == "view_image":
        return display_path(_pick(args, "path", "file_path"), workspace=ws)

    if tool_lower == "list_mcp_resources":
        srv = str(args.get("server") or "").strip() or "(server)"
        return f"list_resources · {srv}"

    if tool_lower == "spawn_agent":
        d = _pick(args, "message", "description", "prompt")
        if not d:
            d = str(args.get("agent_type") or "").strip() or "(spawn_agent)"
        line = d.split("\n", 1)[0].strip()
        return line[:117] + "..." if len(line) > 120 else line

    if tool_lower == "update_plan":
        plan = args.get("plan")
        n = len(plan) if isinstance(plan, list) else 0
        return f"{n} steps" if n else "plan"

    if tool_lower == "send_input":
        msg = str(args.get("message") or "").strip()
        if not msg:
            return str(args.get("id") or "")
        line = msg.split("\n", 1)[0].strip()
        return line[:97] + "..." if len(line) > 100 else line

    if tool_lower == "wait_agent":
        targets = args.get("targets")
        if isinstance(targets, list) and targets:
            sub = ", ".join(str(t) for t in targets[:3])
            if len(targets) > 3:
                sub += f" +{len(targets) - 3}"
            return sub
        return "(wait)"

    if tool_lower == "close_agent":
        return str(args.get("target") or "").strip() or "(target)"

    return ""


def _sid(p: str, t: str) -> str:
    return f"{p}:{(t or '')[:120]}"


def iter_tool_calls(entry: dict) -> list[tuple[str, object]]:
    if entry.get("type") != "response_item":
        return []
    payload = entry.get("payload") or {}
    ptype = str(payload.get("type") or "").strip()
    if ptype == "custom_tool_call":
        return [(str(payload.get("name") or ""), payload.get("input", ""))]
    if ptype == "function_call":
        return [(str(payload.get("name") or ""), payload.get("arguments", ""))]
    return []


def runtime_tool_events(name: object, arguments: object, *, workspace: str = "") -> list[dict]:
    lower = str(name or "").strip().lower()
    if lower in QUIET:
        return []
    a = _coerce_args(arguments)
    if lower == "exec_command":
        event = _exec_command_event(a, workspace=str(workspace or ""))
        if event is None:
            return []
        main, sub = event
        return [runtime_event(main, sub, source_id=_sid(f"tool:{lower}", f"{main}:{sub}"))]
    main = MAIN_LABEL.get(lower)
    if main is None:
        return []
    sub = _codex_subline(lower, a, workspace=str(workspace or "")).strip()
    if not sub:
        return []
    return [runtime_event(main, sub, source_id=_sid(f"tool:{lower}", sub))]


def parse_native_codex_log(filepath: str, limit: int, workspace: str = "") -> list[dict] | None:
    try:
        tail_bytes = 65_536
        with open(filepath, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            start = max(0, size - tail_bytes)
            f.seek(start)
            raw = f.read()
        lines = raw.decode("utf-8", errors="replace").splitlines()
        if start > 0 and lines:
            lines = lines[1:]

        events = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue

            if data.get("type") == "response_item" and "payload" in data:
                payload = data["payload"]
                ptype = payload.get("type")

                if ptype == "reasoning":
                    summary = payload.get("summary") or []
                    for item in summary:
                        if not isinstance(item, dict):
                            continue
                        text = str(item.get("text") or "").strip()
                        if not text:
                            continue
                        events.append(
                            {
                                "kind": "fixed",
                                "text": f"✦ {text}",
                                "source_id": f"thought:codex:✦ {text}",
                            }
                        )
                elif ptype == "custom_tool_call":
                    name = payload.get("name", "")
                    inp = payload.get("input", "")
                    events.extend(runtime_tool_events(name, inp, workspace=workspace))
                elif ptype == "function_call":
                    name = payload.get("name", "")
                    args = payload.get("arguments", "")
                    events.extend(runtime_tool_events(name, args, workspace=workspace))
            if data.get("type") == "event_msg" and "payload" in data:
                payload = data["payload"] or {}
                if payload.get("type") == "agent_reasoning":
                    text = str(payload.get("text") or "").strip()
                    if text:
                        events.append(
                            {
                                "kind": "fixed",
                                "text": f"✦ {text}",
                                "source_id": f"thought:codex:✦ {text}",
                            }
                        )
        return _pane_runtime_gemini_with_occurrence_ids(events, limit=limit)
    except Exception as e:
        logging.error("Failed to parse native codex log %s: %s", filepath, e)
        return None
