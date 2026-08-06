from __future__ import annotations


def entry_window(
    entries: list[dict],
    *,
    limit_override: int | None,
    default_limit: int,
    before_msg_id: str = "",
) -> tuple[list[dict], bool, int]:
    total_count = len(entries)
    limit = limit_override if limit_override is not None else default_limit
    if before_msg_id:
        target = before_msg_id.strip()
        idx = next((i for i, entry in enumerate(entries) if str(entry.get("msg_id") or "") == target), -1)
        if idx < 0:
            return [], False, total_count
        entries = entries[:idx]
    has_older = False
    if limit and limit > 0:
        has_older = len(entries) > limit
        return entries[-limit:], has_older, total_count
    return entries, False, total_count
