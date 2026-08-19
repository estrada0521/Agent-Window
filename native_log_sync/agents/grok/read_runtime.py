from __future__ import annotations

import json

from native_log_sync.agents._shared.runtime_display import runtime_event, short_line
from native_log_sync.agents._shared.runtime_paths import display_path

# Tools that should not flash the Running strip.
_QUIET: frozenset[str] = frozenset(
    {
        "todo_write",
        "todowrite",
        "update_goal",
    }
)

_MAIN_LABEL: dict[str, str] = {
    "run_terminal_command": "Bash",
    "bash": "Bash",
    "read_file": "Read",
    "read": "Read",
    "grep": "Search",
    "list_dir": "Explore",
    "glob": "Explore",
    "search_replace": "Edit",
    "write": "Write",
    "web_search": "Search",
    "websearch": "Search",
    "web_fetch": "Fetch",
    "webfetch": "Fetch",
    "open_page": "Fetch",
    "open_page_with_find": "Search",
    "spawn_subagent": "Agent",
    "task": "Agent",
}


def _source_id(prefix: str, tail: str) -> str:
    return f"{prefix}:{(tail or '')[:120]}"


def _pick(d: object, *keys: str) -> str:
    if not isinstance(d, dict):
        return ""
    for key in keys:
        value = d.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if value is not None and not isinstance(value, (dict, list)) and str(value).strip():
            return str(value).strip()
    return ""


def _coerce_args(arguments: object) -> dict:
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str):
        text = arguments.strip()
        if text.startswith("{"):
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                return {}
            if isinstance(parsed, dict):
                return parsed
    return {}


def _update_payload(entry: object) -> dict | None:
    if not isinstance(entry, dict):
        return None
    params = entry.get("params")
    if not isinstance(params, dict):
        return None
    update = params.get("update")
    return update if isinstance(update, dict) else None


def _tool_name_from_update(update: dict) -> str:
    meta = update.get("_meta")
    if isinstance(meta, dict):
        xai = meta.get("x.ai/tool")
        if isinstance(xai, dict):
            name = str(xai.get("name") or "").strip()
            if name:
                return name
    raw = update.get("rawInput")
    if isinstance(raw, dict):
        variant = str(raw.get("variant") or "").strip()
        if variant:
            # e.g. WebSearch → web_search-ish label for mapping
            if variant.lower() == "websearch":
                return "web_search"
            return variant
    title = str(update.get("title") or "").strip()
    if title.lower().startswith("web search"):
        return "web_search"
    return title or "tool"


def iter_tool_calls_from_update(entry: object) -> list[tuple[str, dict]]:
    """Extract tool starts from a Grok updates.jsonl row.

    Only ``sessionUpdate: tool_call`` is used for Running display. Updates and
    completions are ignored so the strip stays calm (matches Claude/Codex).
    """
    update = _update_payload(entry)
    if update is None:
        return []
    if update.get("sessionUpdate") != "tool_call":
        return []
    name = _tool_name_from_update(update)
    args = _coerce_args(update.get("rawInput"))
    # Prefer toolCallId for stable source ids when present.
    tool_call_id = str(update.get("toolCallId") or "").strip()
    if tool_call_id:
        args = {**args, "_tool_call_id": tool_call_id}
    return [(name, args)]


def _subline(lower: str, args: dict, *, workspace: str) -> str:
    ws = str(workspace or "")
    if lower in {"run_terminal_command", "bash"}:
        desc = _pick(args, "description")
        if desc:
            return short_line(desc)
        return short_line(_pick(args, "command", "cmd"))
    if lower in {"read_file", "read"}:
        return display_path(_pick(args, "target_file", "path", "file_path"), workspace=ws)
    if lower == "grep":
        pattern = _pick(args, "pattern", "query", "q")
        path = _pick(args, "path")
        glob = _pick(args, "glob")
        path_disp = display_path(path, workspace=ws) if path else ""
        scope = path_disp or glob
        if pattern and scope:
            return short_line(f"{pattern} in {scope}")
        return short_line(pattern or scope or "grep")
    if lower in {"list_dir", "glob"}:
        path = _pick(args, "target_directory", "path", "glob_pattern", "pattern")
        return display_path(path, workspace=ws) if path and not path.startswith("*") else short_line(path or ".")
    if lower in {"search_replace", "write"}:
        return display_path(_pick(args, "file_path", "path", "target_file"), workspace=ws)
    if lower in {"web_search", "websearch"}:
        return short_line(_pick(args, "query", "q", "prompt") or "web")
    if lower in {"web_fetch", "webfetch", "open_page"}:
        return short_line(_pick(args, "url", "path"))
    if lower == "open_page_with_find":
        url = _pick(args, "url")
        pattern = _pick(args, "pattern")
        if url and pattern:
            return short_line(f"{pattern} in {url}")
        return short_line(pattern or url or "find")
    if lower in {"spawn_subagent", "task"}:
        return short_line(_pick(args, "description", "prompt", "subagent_type") or "subagent")
    # Generic: first useful string field
    for key in ("path", "target_file", "file_path", "command", "query", "pattern", "description", "url"):
        value = _pick(args, key)
        if value:
            if key in {"path", "target_file", "file_path"}:
                return display_path(value, workspace=ws)
            return short_line(value)
    return ""


def runtime_tool_events(name: object, arguments: object, *, workspace: str = "") -> list[dict]:
    raw_name = str(name or "").strip() or "tool"
    lower = raw_name.lower().replace("-", "_")
    if lower in _QUIET:
        return []
    args = _coerce_args(arguments)
    tool_call_id = _pick(args, "_tool_call_id")
    main = _MAIN_LABEL.get(lower)
    sub = _subline(lower, args, workspace=str(workspace or "")).strip()
    if main is None:
        main = "Tool"
        sub = sub or raw_name
    if not sub:
        sub = raw_name
    sid_tail = tool_call_id or sub
    return [runtime_event(main, sub, source_id=_source_id(f"tool:{lower}", sid_tail))]
