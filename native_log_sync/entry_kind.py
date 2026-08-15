from __future__ import annotations

import re

_GEMINI_PLAN_PREFIX = re.compile(
    r"^\s*(?:✦\s*)?(?:i\s+will|i['’]ll|i\s+am\s+going\s+to|let\s+me)\b",
    re.IGNORECASE,
)
_MAX_PLAN_TEXT_LEN = 280


def _is_planning_style_text(text: str) -> bool:
    body = str(text or "").strip()
    if not body or len(body) > _MAX_PLAN_TEXT_LEN:
        return False
    first_line = body.splitlines()[0].strip()
    if not first_line:
        return False
    return bool(_GEMINI_PLAN_PREFIX.match(first_line))


def strip_sender_prefix(message: str) -> str:
    text = str(message or "").replace("\r\n", "\n").strip()
    if text.startswith("[From:"):
        close = text.find("]")
        if close != -1:
            text = text[close + 1 :].lstrip()
    return text


def should_omit_entry_from_chat(entry: dict) -> bool:
    if not isinstance(entry, dict):
        return False
    sender_name = str(entry.get("sender") or "").strip().lower()
    if not sender_name or sender_name in {"user", "system"}:
        return False
    body = strip_sender_prefix(str(entry.get("message") or ""))
    return _is_planning_style_text(body)
