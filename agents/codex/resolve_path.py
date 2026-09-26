from __future__ import annotations

import os
from pathlib import Path

from agents.process_tree import iter_open_paths_in_process_tree


def resolve_codex_rollout_jsonl_path(pane_pid: str) -> str:
    sessions_root = str((Path.home() / ".codex" / "sessions").resolve())
    candidates: dict[str, float] = {}
    for path in iter_open_paths_in_process_tree(pane_pid):
        if not path.endswith(".jsonl"):
            continue
        if "/rollout-" not in path:
            continue
        try:
            resolved = str(Path(path).resolve())
        except OSError:
            resolved = path
        if resolved in candidates:
            continue
        if not resolved.startswith(sessions_root + "/"):
            continue
        try:
            mtime = os.path.getmtime(resolved)
        except OSError:
            continue
        candidates[resolved] = mtime
    if not candidates:
        return ""
    return max(candidates, key=candidates.get)
