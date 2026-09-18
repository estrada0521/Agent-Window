from __future__ import annotations

from datetime import datetime

from backend_core.access.files import append_jsonl_entry


def _user_client(client: object) -> str | None:
    value = str(client or "").strip().lower()
    if value in {"desktop", "mobile"}:
        return value
    return None


def append_user_entry(
    runtime,
    message: str,
    *,
    targets: list[str],
    client: str | None = None,
) -> dict:
    entry = {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "session": runtime.session_name,
        "sender": "user",
        "targets": list(targets),
        "message": message,
    }
    recorded = _user_client(client)
    if recorded:
        entry["client"] = recorded
    return append_jsonl_entry(runtime.log_path, entry)


def append_system_entry(
    runtime,
    message: str,
    *,
    agent: str = "",
    extra: dict | None = None,
) -> dict:
    entry = {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "session": runtime.session_name,
        "sender": "system",
        "targets": [],
        "message": message,
    }
    if agent:
        entry["agent"] = agent
    if extra:
        entry.update(extra)
    return append_jsonl_entry(runtime.log_path, entry)
