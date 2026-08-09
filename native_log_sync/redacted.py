from __future__ import annotations

REDACTED_TOKEN = "[REDACTED]"


def split_message_from_prefix(message: str) -> tuple[str, str]:
    m = str(message or "")
    if not m.startswith("[From:"):
        return "", m
    idx = m.find("]\n")
    if idx == -1:
        return "", m
    return m[: idx + 2], m[idx + 2 :]


def normalize_cursor_plaintext_for_index(display: str) -> str | None:
    t = (display or "").strip()
    if not t:
        return None
    if t == REDACTED_TOKEN:
        return None
    if t.endswith(REDACTED_TOKEN):
        t = t[: -len(REDACTED_TOKEN)].rstrip()
    if not t:
        return None
    return t


def agent_index_entry_omit_for_redacted(message: str) -> bool:
    _, body = split_message_from_prefix(message)
    b = (body or "").strip()
    if not b:
        return False
    return normalize_cursor_plaintext_for_index(b) is None

