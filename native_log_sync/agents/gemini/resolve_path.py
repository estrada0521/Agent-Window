from __future__ import annotations

import json
from pathlib import Path


def _resolve_antigravity_transcript(runtime, workspace_text: str) -> str:
    base = Path.home() / ".gemini" / "antigravity-cli"
    history_path = base / "history.jsonl"
    if not history_path.is_file():
        return ""

    workspace_aliases = {str(Path(alias).resolve()) for alias in runtime._workspace_aliases(workspace_text)}
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
        if not conversation_id:
            continue
        candidate = (
            base
            / "brain"
            / conversation_id
            / ".system_generated"
            / "logs"
            / "transcript_full.jsonl"
        )
        if candidate.is_file():
            return str(candidate)

    # Never bind an unrelated workspace's newest conversation. Waiting
    # for Antigravity to append its history record is safer than leaking
    # another project's assistant output into this session.
    return ""


def resolve_gemini_native_log(runtime, agent: str, native_log_path: str | None) -> str:
    del agent, native_log_path
    workspace_text = str(runtime.workspace or "").strip()
    if not workspace_text:
        return ""

    return _resolve_antigravity_transcript(runtime, workspace_text)
