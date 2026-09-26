from __future__ import annotations


def normalize_sender_payload(sender: str, payload: str) -> str:
    rest = str(payload or "")
    if not rest:
        return f"[From: {sender}]\n"
    if rest.startswith("\n"):
        rest = rest[1:]
    return f"[From: {sender}]\n{rest}\n"
