from __future__ import annotations

import json
from pathlib import Path


def _resolve_antigravity_conversation_db(runtime, workspace_text: str) -> str:
    base = Path.home() / ".gemini" / "antigravity-cli"
    history_path = base / "history.jsonl"
    conversations_dir = base / "conversations"
    if not history_path.is_file() or not conversations_dir.is_dir():
        return ""

    workspace_aliases = {str(Path(alias).resolve()) for alias in runtime._workspace_aliases(workspace_text)}
    picked_conversation_id = ""
    try:
        lines = history_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        lines = []
    for line in reversed(lines):
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(item, dict):
            continue
        workspace = str(item.get("workspace") or "").strip()
        if workspace:
            try:
                workspace = str(Path(workspace).resolve())
            except OSError:
                pass
        if workspace_aliases and workspace not in workspace_aliases:
            continue
        conversation_id = str(item.get("conversationId") or "").strip()
        if conversation_id:
            candidate = conversations_dir / f"{conversation_id}.db"
            if candidate.is_file():
                picked_conversation_id = conversation_id
                break

    if not picked_conversation_id:
        # Never bind an unrelated workspace's newest conversation. Waiting
        # for Antigravity to append its history record is safer than leaking
        # another project's assistant output into this session.
        return ""

    candidate = conversations_dir / f"{picked_conversation_id}.db"
    return str(candidate) if candidate.is_file() else ""


def resolve_gemini_native_log(runtime, agent: str, native_log_path: str | None) -> str:
    workspace_text = str(runtime.workspace or "").strip()
    if not workspace_text:
        return ""

    return _resolve_antigravity_conversation_db(runtime, workspace_text)
