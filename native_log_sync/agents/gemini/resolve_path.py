from __future__ import annotations

from pathlib import Path

from native_log_sync.agents._shared.process_tree import iter_open_paths_in_process_tree


def resolve_gemini_native_log(pane_pid: str) -> str:
    base = Path.home() / ".gemini" / "antigravity-cli"
    presence_root = str((base / "presence").resolve()).rstrip("/") + "/"
    conversation_ids: set[str] = set()
    for path in iter_open_paths_in_process_tree(pane_pid):
        if not path.startswith(presence_root) or not path.endswith(".lock"):
            continue
        conversation_id = Path(path).stem
        if conversation_id:
            conversation_ids.add(conversation_id)

    if not conversation_ids:
        return ""
    if len(conversation_ids) != 1:
        raise RuntimeError(f"multiple Antigravity conversations match pane PID {pane_pid}")
    conversation_id = next(iter(conversation_ids))
    candidate = base / "brain" / conversation_id / ".system_generated" / "logs" / "transcript_full.jsonl"
    return str(candidate) if candidate.is_file() else ""
