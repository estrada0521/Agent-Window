from __future__ import annotations

import json
from pathlib import Path

from native_log_sync.agents._shared.resolve_path import pick_latest_unclaimed_for_agent


def _normalized_path(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        return str(Path(raw).expanduser().resolve())
    except OSError:
        return raw


def _session_workspace(summary_path: Path) -> str:
    try:
        raw = json.loads(summary_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    if not isinstance(raw, dict):
        return ""
    info = raw.get("info")
    if not isinstance(info, dict):
        return ""
    return _normalized_path(str(info.get("cwd") or ""))


def resolve_grok_chat_history_path(runtime, agent: str) -> str:
    """Return the newest unclaimed Grok chat history for this workspace.

    Grok's session directory does not identify a tmux pane.  Restricting the
    lookup to the exact recorded cwd and refusing already claimed histories
    keeps concurrent Agent Window panes from sharing a transcript.
    """
    workspace = _normalized_path(str(runtime.workspace or ""))
    if not workspace:
        return ""
    sessions_root = Path.home() / ".grok" / "sessions"
    if not sessions_root.is_dir():
        return ""

    candidates: list[Path] = []
    for summary_path in sessions_root.glob("*/*/summary.json"):
        history_path = summary_path.parent / "chat_history.jsonl"
        if not history_path.is_file():
            continue
        if _session_workspace(summary_path) == workspace:
            candidates.append(history_path)

    blocked_path = getattr(runtime, "_native_log_blocked_paths", {}).get(agent, "")
    picked = pick_latest_unclaimed_for_agent(
        candidates,
        runtime._grok_cursors,
        agent,
        blocked_path=blocked_path,
    )
    if picked and picked.is_file():
        runtime._native_log_blocked_paths.pop(agent, None)
        return str(picked)
    return ""
