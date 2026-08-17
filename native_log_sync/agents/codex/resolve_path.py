from __future__ import annotations

import os
from pathlib import Path

from native_log_sync.agents._shared.process_tree import lsof_text, process_tree


def resolve_codex_rollout_jsonl_path(pane_pid: str) -> str:
    # A single codex process can hold several rollout files open at once
    # (context compaction / session forking keeps older handles around), so
    # lsof order is not a reliable signal for which one is actually being
    # written to. Collect every open rollout file across the process tree
    # and pick the one with the newest mtime.
    sessions_root = str((Path.home() / ".codex" / "sessions").resolve())
    candidates: dict[str, float] = {}
    for pid in sorted(process_tree(pane_pid)):
        out = lsof_text(pid)
        if out is None:
            continue
        for line in out.splitlines()[1:]:
            parts = line.split()
            if len(parts) < 9:
                continue
            path = " ".join(parts[8:]).strip()
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
