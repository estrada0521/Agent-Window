from __future__ import annotations

import json
import logging

from native_log_sync.agents._shared.runtime_display import runtime_event
from native_log_sync.agents._shared.runtime_paths import display_path

_QUIET: frozenset[str] = frozenset({"write_stdin", "todoread"})
_MAIN_LABEL: dict[str, str] = {
    "bash": "Bash",
    "read": "Read",
    "glob": "Explore",
    "toolsearch": "ToolSearch",
    "agent": "Agent",
    "mcp__ccd_session__mark_chapter": "MCP",
    "todowrite": "Todo",
    "write": "Write",
    "edit": "Edit",
}


def iter_tool_calls(entry: dict) -> list[tuple[str, dict]]:
    if entry.get("type") != "assistant":
        return []
    msg = entry.get("message")
    if not isinstance(msg, dict):
        return []
    out: list[tuple[str, dict]] = []
    for c in msg.get("content") or []:
        if not isinstance(c, dict):
            continue
        if c.get("type") != "tool_use":
            continue
        name = str(c.get("name") or "tool").strip()
        inp = c.get("input")
        if not isinstance(inp, dict):
            inp = c.get("arguments")
        if not isinstance(inp, dict):
            inp = {}
        out.append((name, inp))
    return out


def _source_id(prefix: str, tail: str) -> str:
    return f"{prefix}:{(tail or '')[:120]}"


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


def _pick(d: object, *keys: str) -> str:
    if not isinstance(d, dict):
        return ""
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _short_line(value: object, limit: int = 120) -> str:
    line = str(value or "").split("\n", 1)[0].strip()
    return line[: limit - 3] + "..." if len(line) > limit else line


def _list_strings(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _browser_subline(tool_lower: str, args: dict, *, workspace: str) -> str:
    action = tool_lower.removeprefix("mcp__playwright__browser_")
    if action == "navigate":
        return f"Navigate {_short_line(args.get('url'))}".strip()
    if action == "click":
        target = _short_line(_pick(args, "element", "target"))
        return f"Click {target}".strip()
    if action == "evaluate":
        filename = display_path(_pick(args, "filename"), workspace=workspace)
        return f"Evaluate {filename}".strip()
    if action == "select_option":
        target = _short_line(_pick(args, "element", "target"))
        values = ", ".join(_list_strings(args.get("values")))
        detail = " · ".join(part for part in (target, _short_line(values)) if part)
        return f"Select {detail}".strip()
    if action == "file_upload":
        paths = _list_strings(args.get("paths"))
        if len(paths) == 1:
            detail = display_path(paths[0], workspace=workspace)
        elif paths:
            detail = f"{len(paths)} files"
        else:
            detail = ""
        return f"Upload {detail}".strip()
    if action == "take_screenshot":
        filename = display_path(_pick(args, "filename"), workspace=workspace)
        return f"Screenshot {filename}".strip()
    if action == "snapshot":
        return "Snapshot"
    if action == "wait_for":
        seconds = args.get("time")
        return f"Wait {seconds}s" if isinstance(seconds, (int, float)) else "Wait"
    if action == "resize":
        width = args.get("width")
        height = args.get("height")
        if isinstance(width, (int, float)) and isinstance(height, (int, float)):
            return f"Resize {width:g}×{height:g}"
        return "Resize"
    if action == "console_messages":
        return f"Console {_short_line(args.get('level'))}".strip()
    label = action.replace("_", " ").strip().title()
    return label or "Action"


def _input_subline(args: dict) -> str:
    questions = args.get("questions")
    if not isinstance(questions, list) or not questions:
        return ""
    first = questions[0]
    text = _short_line(_pick(first, "question", "header"))
    remaining = len(questions) - 1
    return f"{text} (+{remaining})" if text and remaining else text


def _schedule_subline(tool_lower: str, args: dict) -> str:
    if tool_lower == "schedulewakeup":
        seconds = args.get("delaySeconds")
        timing = f" in {seconds:g}s" if isinstance(seconds, (int, float)) else ""
        detail = _short_line(_pick(args, "reason", "prompt"))
        suffix = f" · {detail}" if detail else ""
        return f"Wakeup{timing}{suffix}"
    if tool_lower == "croncreate":
        cron = _short_line(args.get("cron"))
        prompt = _short_line(args.get("prompt"))
        detail = " · ".join(part for part in (cron, prompt) if part)
        return f"Create {detail}".strip()
    if tool_lower == "crondelete":
        return f"Delete {_short_line(args.get('id'))}".strip()
    return ""


def _send_message_subline(args: dict) -> str:
    recipient = _short_line(_pick(args, "recipient", "to"))
    summary = _short_line(_pick(args, "summary", "message", "content"))
    detail = " · ".join(part for part in (recipient, summary) if part)
    return f"Message {detail}".strip()


def _claude_tool_subline(tool_lower: str, args: dict, *, workspace: str) -> str:
    ws = str(workspace or "")
    if tool_lower == "bash":
        cmd = str(args.get("command") or args.get("cmd") or "").strip()
        if not cmd:
            return ""
        line = cmd.split("\n", 1)[0].strip()
        return line[:117] + "..." if len(line) > 120 else line
    if tool_lower == "read":
        path = display_path(_pick(args, "path", "file_path", "notebook_path"), workspace=ws)
        bits: list[str] = []
        if "offset" in args and args.get("offset") is not None:
            bits.append(f"@{args.get('offset')}")
        if "limit" in args and args.get("limit") is not None:
            bits.append(f"limit {args.get('limit')}")
        suf = f" ({', '.join(bits)})" if bits else ""
        return (path or "") + suf
    if tool_lower == "glob":
        pat = str(args.get("glob_pattern") or args.get("pattern") or "").strip()
        base_raw = str(args.get("target_directory") or args.get("path") or "").strip()
        base = display_path(base_raw, workspace=ws) if base_raw else ""
        if pat and base:
            return f"{pat} in {base}"
        if pat:
            return pat
        return base or "."
    if tool_lower == "toolsearch":
        return str(args.get("query") or "").strip()
    if tool_lower == "agent":
        d = _pick(args, "description", "prompt")
        if not d:
            return ""
        line = d.split("\n", 1)[0].strip()
        return line[:117] + "..." if len(line) > 120 else line
    if tool_lower == "mcp__ccd_session__mark_chapter":
        t = _pick(args, "title", "summary")
        if len(t) > 120:
            t = t[:117] + "…"
        return f"mark_chapter · {t}" if t else "mark_chapter"
    if tool_lower == "todowrite":
        todos = args.get("todos")
        n = len(todos) if isinstance(todos, list) else 0
        if n <= 0:
            return "update"
        if n == 1 and isinstance(todos, list):
            t0 = todos[0]
            if isinstance(t0, dict):
                c = str(t0.get("content") or t0.get("activeForm") or "").strip()
                return (c[:100] + ("…" if len(c) > 100 else "")) if c else "1 item"
            return "1 item"
        return f"{n} items"
    if tool_lower == "write":
        return display_path(_pick(args, "file_path", "path"), workspace=ws)
    if tool_lower == "edit":
        return display_path(_pick(args, "file_path", "path"), workspace=ws)
    return ""


def runtime_tool_events(name: object, arguments: object, *, workspace: str = "") -> list[dict]:
    raw_name = str(name or "").strip() or "tool"
    lower = raw_name.lower()
    if lower in _QUIET:
        return []
    a = _coerce_args(arguments)
    if not isinstance(a, dict):
        a = {}
    ws = str(workspace or "")

    if lower.startswith("mcp__playwright__browser_"):
        main = "Browser"
        sub = _browser_subline(lower, a, workspace=ws)
    elif lower == "websearch":
        main = "Search"
        sub = _short_line(a.get("query"))
    elif lower == "webfetch":
        main = "Fetch"
        sub = _short_line(_pick(a, "url", "prompt"))
    elif lower == "askuserquestion":
        main = "Input"
        sub = _input_subline(a)
    elif lower in {"schedulewakeup", "croncreate", "crondelete"}:
        main = "Schedule"
        sub = _schedule_subline(lower, a)
    elif lower == "skill":
        main = "Skill"
        sub = _short_line(a.get("skill"))
    elif lower == "sendmessage":
        main = "Agent"
        sub = _send_message_subline(a)
    else:
        main = _MAIN_LABEL.get(lower)
        if main is None:
            return [runtime_event("Tool", raw_name, source_id=_source_id("tool:unknown", raw_name))]
        sub = _claude_tool_subline(lower, a, workspace=ws).strip()
    return [runtime_event(main, sub, source_id=_source_id(f"tool:{lower}", sub))]
