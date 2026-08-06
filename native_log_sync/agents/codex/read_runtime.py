from __future__ import annotations

import ast
import json
import logging
import os
import re
import shlex
import time
from pathlib import Path

from native_log_sync.event_format import _pane_runtime_gemini_with_occurrence_ids
from backend_core.access.files import append_jsonl_entry

from native_log_sync.agents._shared.runtime_display import runtime_event
from native_log_sync.agents._shared.runtime_paths import display_path

# Transport/polling calls were also intentionally quiet in the 5.5 display.
QUIET: frozenset[str] = frozenset({"wait", "write_stdin"})
MAIN_LABEL: dict[str, str] = {
    "apply_patch": "Edit",
    "view_image": "Read",
    "list_mcp_resources": "MCP",
    "list_mcp_resource_templates": "MCP",
    "read_mcp_resource": "MCP",
    "spawn_agent": "Agent",
    "followup_task": "Agent",
    "send_message": "Agent",
    "interrupt_agent": "Agent",
    "list_agents": "Agent",
    "update_plan": "Plan",
    "get_goal": "Goal",
    "update_goal": "Goal",
    "web__run": "Web",
    "image_gen__imagegen": "Image",
    "request_user_input": "Input",
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
        # Early 5.6 builds emitted JavaScript object literals rather than
        # strict JSON (for example ``{cmd:"pwd",workdir:"."}``). Extract
        # only the display fields; never evaluate the native-log input.
        loose = {
            key: value
            for key in (
                "cmd",
                "command",
                "description",
                "file_path",
                "message",
                "objective",
                "path",
                "prompt",
                "query",
                "server",
                "target",
                "url",
                "workdir",
            )
            if (value := _js_object_string_property(t, key))
        }
        return loose or t

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


def _skip_js_quoted(text: str, start: int) -> int:
    """Return the first position after a JS string/template literal."""

    quote = text[start]
    i = start + 1
    while i < len(text):
        char = text[i]
        if char == "\\":
            i += 2
            continue
        if char == quote:
            return i + 1
        i += 1
    return len(text)


def _skip_js_comment(text: str, start: int) -> int:
    if text.startswith("//", start):
        end = text.find("\n", start + 2)
        return len(text) if end < 0 else end + 1
    if text.startswith("/*", start):
        end = text.find("*/", start + 2)
        return len(text) if end < 0 else end + 2
    return start


def _js_object_string_property(source: str, key: str) -> str:
    match = re.search(rf"(?:^|[,{{])\s*{re.escape(key)}\s*:\s*", source)
    if not match:
        return ""
    start = match.end()
    if start >= len(source) or source[start] not in {'"', "'", "`"}:
        return ""
    end = _skip_js_quoted(source, start)
    token = source[start:end]
    try:
        if token.startswith('"'):
            value = json.loads(token)
        elif token.startswith("'"):
            value = ast.literal_eval(token)
        else:
            # Preserve interpolation markers as display text. This parser
            # never executes them, so templates remain safe and informative.
            value = token[1:-1].replace("\\n", "\n").replace("\\`", "`")
    except (SyntaxError, ValueError, json.JSONDecodeError):
        return ""
    return value if isinstance(value, str) else ""


def _find_js_call_end(text: str, open_paren: int) -> int:
    depth = 1
    i = open_paren + 1
    while i < len(text):
        char = text[i]
        if char in {'"', "'", "`"}:
            i = _skip_js_quoted(text, i)
            continue
        comment_end = _skip_js_comment(text, i)
        if comment_end != i:
            i = comment_end
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _first_js_argument(source: str) -> str:
    depths = {"(": 0, "[": 0, "{": 0}
    pairs = {")": "(", "]": "[", "}": "{"}
    i = 0
    while i < len(source):
        char = source[i]
        if char in {'"', "'", "`"}:
            i = _skip_js_quoted(source, i)
            continue
        comment_end = _skip_js_comment(source, i)
        if comment_end != i:
            i = comment_end
            continue
        if char in depths:
            depths[char] += 1
        elif char in pairs:
            key = pairs[char]
            depths[key] = max(0, depths[key] - 1)
        elif char == "," and not any(depths.values()):
            return source[:i].strip()
        i += 1
    return source.strip()


def _decode_js_literal(source: str) -> object:
    value = source.strip()
    if not value:
        return ""
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        pass
    if len(value) >= 2 and value[0] == value[-1] == "`" and "${" not in value:
        # Codex currently uses JSON strings, but accepting a plain template
        # literal keeps free-form tools such as apply_patch readable.
        return value[1:-1].replace("\\n", "\n").replace("\\`", "`")
    return value


def _resolve_js_argument(source: str, script_prefix: str) -> object:
    value = _first_js_argument(source)
    if re.fullmatch(r"[A-Za-z_$][\w$]*", value):
        assignment = re.compile(rf"\b(?:const|let|var)\s+{re.escape(value)}\s*=\s*")
        matches = list(assignment.finditer(script_prefix))
        if matches:
            start = matches[-1].end()
            end = start
            while end < len(script_prefix):
                char = script_prefix[end]
                if char in {'"', "'", "`"}:
                    end = _skip_js_quoted(script_prefix, end)
                    continue
                if char == ";":
                    break
                end += 1
            value = script_prefix[start:end].strip()
    return _decode_js_literal(value)


def _iter_codex_5_6_exec_calls(script: object) -> list[tuple[str, object]]:
    """Unwrap nested tool calls from the Codex 5.6 outer ``exec`` tool."""

    if not isinstance(script, str) or not script.strip():
        return []
    calls: list[tuple[str, object]] = []
    i = 0
    while i < len(script):
        char = script[i]
        if char in {'"', "'", "`"}:
            i = _skip_js_quoted(script, i)
            continue
        comment_end = _skip_js_comment(script, i)
        if comment_end != i:
            i = comment_end
            continue
        if script.startswith("tools.", i) and (i == 0 or not (script[i - 1].isalnum() or script[i - 1] in "_$")):
            name_start = i + len("tools.")
            match = re.match(r"[A-Za-z_$][\w$]*", script[name_start:])
            if match:
                name = match.group(0)
                open_paren = name_start + len(name)
                while open_paren < len(script) and script[open_paren].isspace():
                    open_paren += 1
                if open_paren < len(script) and script[open_paren] == "(":
                    close_paren = _find_js_call_end(script, open_paren)
                    # A small number of persisted 5.6 records end before the
                    # wrapper's closing parenthesis. The tool name and leading
                    # display fields are still usable, so recover to EOF.
                    call_end = close_paren if close_paren >= 0 else len(script)
                    args_source = script[open_paren + 1 : call_end]
                    calls.append((name, _resolve_js_argument(args_source, script[:i])))
                    i = call_end + 1
                    continue
        i += 1
    if not calls:
        # Some persisted scripts contain JS regex literals such as /'/g.
        # The intentionally small lexer can conservatively mistake the quote
        # inside that regex for a string delimiter. An actual nested call is
        # still unambiguous when introduced by ``await tools.``; use that
        # narrow transport-generated anchor only as a second pass.
        awaited = re.compile(r"\bawait\s+tools\.([A-Za-z_$][\w$]*)\s*\(")
        for match in awaited.finditer(script):
            name = match.group(1)
            open_paren = match.end() - 1
            close_paren = _find_js_call_end(script, open_paren)
            call_end = close_paren if close_paren >= 0 else len(script)
            args_source = script[open_paren + 1 : call_end]
            calls.append((name, _resolve_js_argument(args_source, script[: match.start()])))
    return calls


def iter_tool_calls(entry: dict) -> list[tuple[str, object]]:
    """Read active Codex 5.6 tool-call envelopes.

    Codex 5.5 ``function_call`` support is intentionally retired from this
    path; see ``read_runtime_legacy_5_5.py`` for the archived reader.
    """

    if entry.get("type") != "response_item":
        return []
    payload = entry.get("payload") or {}
    ptype = str(payload.get("type") or "").strip()
    if ptype == "custom_tool_call":
        name = str(payload.get("name") or "")
        inp = payload.get("input", "")
        if name.strip().lower() == "exec":
            # The outer exec is only a transport envelope in 5.6. Some exec
            # scripts only format output and contain no nested tool at all.
            return _iter_codex_5_6_exec_calls(inp)
        return [(name, inp)]
    if ptype == "web_search_call":
        return [("web_search", payload.get("action") or {})]
    if ptype == "tool_search_call":
        return [("tool_search", payload.get("arguments") or {})]
    return []


def runtime_tool_events(name: object, arguments: object, *, workspace: str = "") -> list[dict]:
    lower = str(name or "").strip().lower()
    if lower in QUIET or not lower:
        return []
    a = _coerce_args(arguments)
    if lower == "exec_command":
        event = _exec_command_event(a, workspace=str(workspace or ""))
        if event is None:
            # Some 5.6 scripts pass ``{cmd}`` shorthand where the value comes
            # from earlier JavaScript. Preserve the call even when there is no
            # safe, non-evaluating way to reconstruct that variable.
            return [runtime_event("Shell", "exec_command", source_id="tool:exec_command:fallback")]
        main, sub = event
        return [runtime_event(main, sub, source_id=_sid(f"tool:{lower}", f"{main}:{sub}"))]
    if lower == "web_search":
        action = _pick(a, "type") or "web"
        sub = _pick(a, "query", "url") or action
        main = "Search" if action == "search" else "Web"
        sub = _truncate_line(sub)
        return [runtime_event(main, sub, source_id=_sid("tool:web_search", f"{action}:{sub}"))]
    if lower == "tool_search":
        sub = _truncate_line(_pick(a, "query") or "tools")
        return [runtime_event("Tool Search", sub, source_id=_sid("tool:tool_search", sub))]
    main = MAIN_LABEL.get(lower)
    sub = _codex_subline(lower, a, workspace=str(workspace or "")).strip() if main else ""
    if main is None:
        # 5.6 can add connector/MCP tools without changing the envelope. Do
        # not silently lose them: preserve a compact generic runtime event.
        main = "Tool"
        sub = lower
    if not sub:
        sub = lower
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
                else:
                    for name, inp in iter_tool_calls(data):
                        events.extend(runtime_tool_events(name, inp, workspace=workspace))
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
