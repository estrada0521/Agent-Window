from __future__ import annotations

import json
from pathlib import Path

from native_log_sync.agents._shared.process_tree import process_tree


def _normalized_path(value: str) -> str:
    return str(Path(value).expanduser().resolve())


def resolve_claude_session_jsonl_path(runtime, pane_id: str, pane_pid: str) -> str:
    workspace = str(runtime.workspace or "").strip()
    if not workspace:
        return ""
    workspace_aliases = {
        _normalized_path(alias)
        for alias in runtime._workspace_aliases(workspace)
    }

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
        cwd = str(record.get("cwd") or "").strip()
        tmux = str(record.get("tmux") or "").strip()
        if not cwd or _normalized_path(cwd) not in workspace_aliases:
            continue
        if tmux and pane_id and not tmux.endswith(f".{pane_id}"):
            continue
        matches.append(record)

    if not matches:
        return ""
    if len(matches) != 1:
        raise RuntimeError(f"multiple Claude sessions match pane {pane_id}")

    record = matches[0]
    session_id = str(record.get("sessionId") or "").strip()
    cwd = str(record.get("cwd") or "").strip()
    if not session_id or not cwd:
        raise RuntimeError(f"Claude session record is incomplete for pane {pane_id}")
    project_slug = cwd.replace("/", "-").lstrip("-")
    candidate = Path.home() / ".claude" / "projects" / f"-{project_slug}" / f"{session_id}.jsonl"
    return str(candidate) if candidate.is_file() else ""
