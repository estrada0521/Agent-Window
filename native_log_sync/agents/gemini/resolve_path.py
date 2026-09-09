from __future__ import annotations

from pathlib import Path

from native_log_sync.agents._shared.process_tree import lsof_text, process_tree


def resolve_gemini_native_log(pane_pid: str) -> str:
    base = Path.home() / ".gemini" / "antigravity-cli"
    presence_root = str((base / "presence").resolve()).rstrip("/") + "/"
    conversation_ids: set[str] = set()
    for pid in process_tree(pane_pid):
        output = lsof_text(pid)
        if output is None:
            continue
        for line in output.splitlines()[1:]:
            parts = line.split()
            if len(parts) < 9:
                continue
            path = " ".join(parts[8:]).strip()
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
