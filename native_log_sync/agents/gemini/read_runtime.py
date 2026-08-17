from __future__ import annotations

import json
import os
import shlex

from native_log_sync.agents._shared.runtime_display import runtime_event
from native_log_sync.agents._shared.runtime_paths import display_path


def iter_tool_calls(entry: dict) -> list[tuple[str, dict]]:
    """Read tool calls from Antigravity's generated transcript JSONL."""

    if not isinstance(entry, dict) or str(entry.get("source") or "").upper() != "MODEL":
        return []
    calls: list[tuple[str, dict]] = []
    for call in entry.get("tool_calls") or []:
        if not isinstance(call, dict):
            continue
        name = str(call.get("name") or "").strip()
        if not name:
            continue
        args = call.get("args")
        calls.append((name, _normalize_transcript_args(args) if isinstance(args, dict) else {}))
    return calls


def _normalize_transcript_args(value: object) -> object:
    if isinstance(value, dict):
        return {key: _normalize_transcript_args(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalize_transcript_args(item) for item in value]
    if not isinstance(value, str):
        return value
    text = value.strip()
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        try:
            decoded = json.loads(text)
        except json.JSONDecodeError:
            return value
        return decoded
    return value


def parse_antigravity_transcript_step(entry: dict | None) -> tuple[str, list[tuple[str, dict]]]:
    if not isinstance(entry, dict):
        return "", []
    if str(entry.get("source") or "").upper() != "MODEL":
        return "", []
    if str(entry.get("type") or "").upper() != "PLANNER_RESPONSE":
        return "", []
    text = str(entry.get("content") or "").strip()
    return text, iter_tool_calls(entry)


def _pick(args: object, *keys: str) -> str:
    if not isinstance(args, dict):
        return ""
    for key in keys:
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _short_line(value: str, limit: int = 120) -> str:
    line = str(value or "").split("\n", 1)[0].strip()
    return line[: limit - 3] + "..." if len(line) > limit else line


def _command_label(command: str) -> str:
    line = _short_line(command)
    if not line:
        return ""
    try:
        tokens = shlex.split(line)
    except ValueError:
        tokens = line.split()
    if not tokens:
        return line
    base = os.path.basename(tokens[0]).lower()
    if base in {"git"}:
        return f"Git {' '.join(tokens[1:])}".strip()
    if base in {"rg", "grep"}:
        return f"Search {line}"
    if base in {"cat", "head", "tail", "sed", "nl", "wc", "find"}:
        return f"Read {line}"
    if base in {"ls", "pwd"}:
        return f"Explore {line}"
    if base in {"python", "python3", "node", "npm", "npx"}:
        return f"Run {line}"
    return f"Shell {line}"


def _source_id(name: str, sub: str) -> str:
    return f"tool:{name[:60]}:{sub[:120]}"


def runtime_tool_events(name: object, arguments: object, *, workspace: str = "") -> list[dict]:
    raw_name = str(name or "").strip() or "tool"
    lower = raw_name.lower()
    args = arguments if isinstance(arguments, dict) else {}
    ws = str(workspace or "")
    main = ""
    sub = ""

    if lower in {"command_status", "manage_task"}:
        return []
    if lower == "view_file":
        main = "Read"
        sub = display_path(_pick(args, "AbsolutePath"), workspace=ws)
    elif lower == "list_dir":
        main = "Explore"
        sub = display_path(_pick(args, "DirectoryPath"), workspace=ws)
    elif lower == "grep_search":
        main = "Search"
        query = _pick(args, "Query")
        path = display_path(_pick(args, "SearchPath"), workspace=ws)
        sub = f"{query} in {path}" if query and path else query or path
    elif lower == "find_by_name":
        main = "Search"
        pattern = _pick(args, "Pattern")
        path = display_path(_pick(args, "SearchDirectory"), workspace=ws)
        sub = f"{pattern} in {path}" if pattern and path else pattern or path
    elif lower == "run_command":
        labeled = _command_label(_pick(args, "CommandLine"))
        if labeled:
            main, _, sub = labeled.partition(" ")
    elif lower in {"replace_file_content", "multi_replace_file_content"}:
        main = "Edit"
        sub = display_path(_pick(args, "TargetFile"), workspace=ws)
    elif lower in {"write_to_file", "write_file"}:
        main = "Write"
        sub = display_path(_pick(args, "TargetFile"), workspace=ws)
    elif lower == "search_web":
        main = "Web"
        sub = _pick(args, "query", "Query")
    elif lower in {"define_subagent", "invoke_subagent"}:
        main = "Agent"
        sub = _pick(args, "toolSummary", "toolAction") or raw_name
    elif lower == "send_message":
        main = "Message"
        sub = _pick(args, "Recipient")
    else:
        main = "Tool"
        sub = raw_name

    sub = _short_line(sub)
    if not main:
        return []
    return [runtime_event(main, sub, source_id=_source_id(lower, f"{main}:{sub}"))]
