from __future__ import annotations

import re

from native_log_sync.agents._shared.process_tree import iter_open_paths_in_process_tree
from native_log_sync.agents._shared.workspace_paths import cursor_transcript_roots


_STORE_DB_RE = re.compile(r"/\.cursor/chats/[^/]+/([0-9a-f-]+)/store\.db(?:-wal|-shm)?$")


def resolve_cursor_session_jsonl_path(runtime, pane_pid: str) -> str:
    workspace_text = str(runtime.workspace or "").strip()
    if not workspace_text:
        return ""
    roots = cursor_transcript_roots(runtime, workspace_text)
    if not roots:
        return ""

    for store_path in iter_open_paths_in_process_tree(pane_pid):
        match = _STORE_DB_RE.search(store_path)
        if not match:
            continue
        session_id = match.group(1)
        for root in roots:
            candidate = root / session_id / f"{session_id}.jsonl"
            if candidate.is_file():
                return str(candidate)
    return ""
