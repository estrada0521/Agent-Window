from __future__ import annotations

import re

from native_log_sync.agents._shared.process_tree import lsof_text, process_tree
from native_log_sync.agents._shared.workspace_paths import cursor_transcript_roots


_STORE_DB_RE = re.compile(r"/\.cursor/chats/[^/]+/([0-9a-f-]+)/store\.db(?:-wal|-shm)?$")


def _cursor_store_paths_for_pid_tree(pane_pid: str) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()
    for pid in sorted(process_tree(pane_pid)):
        out = lsof_text(pid)
        if out is None:
            continue
        for line in out.splitlines()[1:]:
            parts = line.split()
            if len(parts) < 9:
                continue
            path = " ".join(parts[8:]).strip()
            if not path:
                continue
            if not _STORE_DB_RE.search(path):
                continue
            if path in seen:
                continue
            seen.add(path)
            paths.append(path)
    return paths


def resolve_cursor_session_jsonl_path(runtime, pane_pid: str) -> str:
    workspace_text = str(runtime.workspace or "").strip()
    if not workspace_text:
        return ""
    roots = cursor_transcript_roots(runtime, workspace_text)
    if not roots:
        return ""

    for store_path in _cursor_store_paths_for_pid_tree(pane_pid):
        match = _STORE_DB_RE.search(store_path)
        if not match:
            continue
        session_id = match.group(1)
        for root in roots:
            candidate = root / session_id / f"{session_id}.jsonl"
            if candidate.is_file():
                return str(candidate)
    return ""
