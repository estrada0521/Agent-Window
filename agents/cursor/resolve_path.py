from __future__ import annotations

import re
from pathlib import Path

from agents.process_tree import iter_open_paths_in_process_tree


_STORE_DB_RE = re.compile(r"/\.cursor/chats/[^/]+/([0-9a-f-]+)/store\.db(?:-wal|-shm)?$")


def resolve_cursor_session_jsonl_path(pane_pid: str) -> str:
    projects_root = Path.home() / ".cursor" / "projects"
    for store_path in iter_open_paths_in_process_tree(pane_pid):
        match = _STORE_DB_RE.search(store_path)
        if not match:
            continue
        session_id = match.group(1)
        candidates = list(projects_root.glob(f"*/agent-transcripts/{session_id}/{session_id}.jsonl"))
        if len(candidates) > 1:
            raise RuntimeError(f"multiple Cursor transcripts match session {session_id}")
        if candidates:
            return str(candidates[0])
    return ""
