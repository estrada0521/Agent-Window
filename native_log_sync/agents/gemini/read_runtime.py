from __future__ import annotations

import json
import logging
import os
import shlex
import sqlite3
from collections.abc import Iterable
from pathlib import Path

from native_log_sync.agents._shared.runtime_display import runtime_event
from native_log_sync.agents._shared.runtime_paths import display_path


def _read_varint(data: bytes, index: int) -> tuple[int, int] | None:
    shift = 0
    value = 0
    while index < len(data) and shift < 70:
        byte = data[index]
        index += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, index
        shift += 7
    return None


def _wire_fields(data: bytes) -> list[tuple[int, int, object]] | None:
    """Decode one protobuf message without requiring Antigravity's private schema."""

    fields: list[tuple[int, int, object]] = []
    index = 0
    while index < len(data):
        key_result = _read_varint(data, index)
        if key_result is None:
            return None
        key, index = key_result
        number = key >> 3
        wire_type = key & 7
        if number <= 0:
            return None
        if wire_type == 0:
            value_result = _read_varint(data, index)
            if value_result is None:
                return None
            value, index = value_result
        elif wire_type == 1:
            if index + 8 > len(data):
                return None
            value = data[index : index + 8]
            index += 8
        elif wire_type == 2:
            length_result = _read_varint(data, index)
            if length_result is None:
                return None
            length, index = length_result
            if index + length > len(data):
                return None
            value = data[index : index + length]
            index += length
        elif wire_type == 5:
            if index + 4 > len(data):
                return None
            value = data[index : index + 4]
            index += 4
        else:
            return None
        fields.append((number, wire_type, value))
    return fields


def _bytes_fields(fields: Iterable[tuple[int, int, object]], number: int) -> list[bytes]:
    return [value for field, wire, value in fields if field == number and wire == 2 and isinstance(value, bytes)]


def _utf8(value: bytes) -> str:
    try:
        return value.decode("utf-8")
    except UnicodeDecodeError:
        return ""


def _looks_like_planner_message(data: bytes) -> bool:
    fields = _wire_fields(data)
    if fields is None:
        return False
    if _bytes_fields(fields, 1) and _bytes_fields(fields, 8):
        return True
    for raw_tool in _bytes_fields(fields, 7):
        tool_fields = _wire_fields(raw_tool)
        if tool_fields is not None and _bytes_fields(tool_fields, 3) and (
            _bytes_fields(tool_fields, 2) or _bytes_fields(tool_fields, 9)
        ):
            return True
    return False


def _planner_message(payload: bytes) -> bytes:
    outer = _wire_fields(payload or b"")
    if outer is None:
        return b""

    # Field 20 is the current Antigravity planner response envelope. Keep a
    # structural fallback so a harmless outer-field renumbering does not
    # silently drop all Antigravity output again.
    preferred = _bytes_fields(outer, 20)
    for candidate in reversed(preferred):
        if _looks_like_planner_message(candidate):
            return candidate
    for _number, wire, candidate in reversed(outer):
        if wire == 2 and isinstance(candidate, bytes) and _looks_like_planner_message(candidate):
            return candidate
    return b""


def parse_antigravity_planner_step(payload: bytes) -> tuple[str, list[tuple[str, dict]]]:
    """Return the visible assistant text and tool calls from a type-15 step."""

    planner = _planner_message(payload)
    fields = _wire_fields(planner)
    if fields is None:
        return "", []

    response = ""
    # The visible response is duplicated in fields 1 and 8. Field 8 is the
    # rendered final value; field 1 is retained as a compatibility fallback.
    for number in (8, 1):
        values = [_utf8(raw).strip() for raw in _bytes_fields(fields, number)]
        values = [value for value in values if value]
        if values:
            response = values[-1]
            break

    calls: list[tuple[str, dict]] = []
    for raw_tool in _bytes_fields(fields, 7):
        tool_fields = _wire_fields(raw_tool)
        if tool_fields is None:
            continue
        name_values = _bytes_fields(tool_fields, 9) or _bytes_fields(tool_fields, 2)
        name = _utf8(name_values[-1]).strip() if name_values else ""
        if not name:
            continue
        args: dict = {}
        raw_args = _bytes_fields(tool_fields, 3)
        if raw_args:
            try:
                decoded = json.loads(_utf8(raw_args[-1]))
            except json.JSONDecodeError:
                decoded = None
            if isinstance(decoded, dict):
                args = decoded
        calls.append((name, args))
    return response, calls


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


def load_antigravity_transcript_entries(db_path: str) -> dict[int, dict]:
    """Load the CLI-rendered transcript as a fallback for future DB schemas."""

    db = Path(db_path)
    base = db.parent.parent
    logs = base / "brain" / db.stem / ".system_generated" / "logs"
    entries: dict[int, dict] = {}
    # transcript_full contains untruncated fields but can be rotated. Load the
    # long-lived transcript first, then overwrite only indexes present in full.
    for filename in ("transcript.jsonl", "transcript_full.jsonl"):
        path = logs / filename
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(entry, dict) or not isinstance(entry.get("step_index"), int):
                continue
            entries[int(entry["step_index"])] = entry
    return entries


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
