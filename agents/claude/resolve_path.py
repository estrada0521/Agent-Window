from __future__ import annotations

import json
from pathlib import Path

from agents.process_tree import process_tree


def resolve_claude_session_jsonl_path(pane_id: str, pane_pid: str) -> str:
    matches: list[dict] = []
    sessions_root = Path.home() / ".claude" / "sessions"
    for pid in process_tree(pane_pid):
        record_path = sessions_root / f"{pid}.json"
        if not record_path.is_file():
            continue
        try:
            record = json.loads(record_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"unreadable Claude session record: {record_path}: {exc}") from exc
        if not isinstance(record, dict):
            raise RuntimeError(f"Claude session record is not an object: {record_path}")
        if str(record.get("pid") or "") != pid:
            raise RuntimeError(f"Claude session PID mismatch: {record_path}")
        tmux = str(record.get("tmux") or "").strip()
        if tmux and not tmux.endswith(f".{pane_id}"):
            continue
        matches.append(record)

    if not matches:
        return ""
    if len(matches) != 1:
        raise RuntimeError(f"multiple Claude sessions match pane {pane_id}")

    session_id = str(matches[0].get("sessionId") or "").strip()
    if not session_id:
        raise RuntimeError(f"Claude session record has no sessionId for pane {pane_id}")
    candidates = list((Path.home() / ".claude" / "projects").glob(f"*/{session_id}.jsonl"))
    if len(candidates) > 1:
        raise RuntimeError(f"multiple Claude logs match session {session_id}")
    return str(candidates[0]) if candidates else ""
