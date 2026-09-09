from __future__ import annotations

import json
from pathlib import Path

from native_log_sync.agents._shared.process_tree import process_tree


def _normalized_path(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        return str(Path(raw).expanduser().resolve())
    except OSError:
        return raw


def _active_sessions(path: Path) -> list[dict]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"unreadable Grok active session registry: {path}: {exc}") from exc
    if not isinstance(raw, list) or any(not isinstance(item, dict) for item in raw):
        raise RuntimeError(f"Grok active session registry is not a list of objects: {path}")
    return raw


def resolve_grok_updates_path(runtime, pane_pid: str) -> str:
    workspace = _normalized_path(str(runtime.workspace or ""))
    if not workspace:
        return ""
    registry_path = Path.home() / ".grok" / "active_sessions.json"
    if not registry_path.is_file():
        return ""

    pane_pids = process_tree(pane_pid)
    matches: list[str] = []
    for item in _active_sessions(registry_path):
        if str(item.get("pid") or "") not in pane_pids:
            continue
        if _normalized_path(str(item.get("cwd") or "")) != workspace:
            continue
        session_id = str(item.get("session_id") or "").strip()
        if session_id:
            matches.append(session_id)

    if not matches:
        return ""
    if len(matches) != 1:
        raise RuntimeError(f"multiple Grok sessions match pane PID {pane_pid}")

    session_id = matches[0]
    candidates = list((Path.home() / ".grok" / "sessions").glob(f"*/{session_id}/updates.jsonl"))
    if not candidates:
        return ""
    if len(candidates) != 1:
        raise RuntimeError(f"multiple Grok update logs match session {session_id}")
    history_path = candidates[0].with_name("chat_history.jsonl")
    return str(candidates[0]) if history_path.is_file() else ""
