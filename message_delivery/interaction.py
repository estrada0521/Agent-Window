from __future__ import annotations


def normalize_sender_payload(sender: str, payload: str) -> str:
    sender_label = "User" if sender == "user" else sender
    rest = str(payload or "")
    if not rest:
        return f"[From: {sender_label}]\n"
    if rest.startswith("\n"):
        rest = rest[1:]
    return f"[From: {sender_label}]\n{rest}\n"
