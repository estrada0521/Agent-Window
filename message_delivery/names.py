from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
from typing import Callable

from backend_core.access.settings import session_log_path


AGENT_NAMES_KEY = "agent_names"
MAX_AGENT_NAME_LENGTH = 64


def session_meta_path(session_name: str) -> Path:
    return session_log_path(session_name).parent / ".meta"


def _clean_agent_names(raw: object) -> dict[str, str]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("agent_names must be an object")
    names: dict[str, str] = {}
    for canonical, display in raw.items():
        canonical_name = str(canonical or "").strip().lower()
        display_name = str(display or "").strip()
        if canonical_name and display_name:
            names[canonical_name] = display_name
    return names


def _read_meta(handle) -> dict:
    handle.seek(0)
    raw_text = handle.read()
    if not str(raw_text).strip():
        raise ValueError("session meta is empty")
    raw = json.loads(raw_text)
    if not isinstance(raw, dict):
        raise ValueError("session meta is not an object")
    return raw


def load_agent_names(session_name: str) -> dict[str, str]:
    path = session_meta_path(session_name)
    if not path.is_file():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return _clean_agent_names(_read_meta(handle).get(AGENT_NAMES_KEY))


def _update_agent_names(
    session_name: str,
    update: Callable[[dict[str, str]], None],
) -> dict[str, str]:
    path = session_meta_path(session_name)
    with path.open("r+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            meta = _read_meta(handle)
            names = _clean_agent_names(meta.get(AGENT_NAMES_KEY))
            update(names)
            if names:
                meta[AGENT_NAMES_KEY] = names
            else:
                meta.pop(AGENT_NAMES_KEY, None)
            handle.seek(0)
            handle.truncate()
            json.dump(meta, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
            return dict(names)
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def validate_agent_display_name(display_name: str) -> str:
    name = str(display_name or "").strip()
    if not name:
        raise ValueError("Agent name cannot be empty.")
    if len(name) > MAX_AGENT_NAME_LENGTH:
        raise ValueError(f"Agent name must be at most {MAX_AGENT_NAME_LENGTH} characters.")
    if name.startswith("-"):
        raise ValueError("Agent name cannot start with '-'.")
    if any(char in name for char in ("\r", "\n", "]", ",")):
        raise ValueError("Agent name cannot contain a newline, ']', or ','.")
    if any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise ValueError("Agent name cannot contain control characters.")
    return name


def set_agent_name(session_name: str, canonical: str, display_name: str) -> dict[str, str]:
    canonical_name = str(canonical or "").strip().lower()
    name = validate_agent_display_name(display_name)
    if not canonical_name:
        raise ValueError("Canonical agent instance cannot be empty.")

    def update(names: dict[str, str]) -> None:
        names[canonical_name] = name

    return _update_agent_names(session_name, update)


def remove_agent_name(session_name: str, canonical: str) -> tuple[str, dict[str, str]]:
    canonical_name = str(canonical or "").strip().lower()
    removed = ""

    def update(names: dict[str, str]) -> None:
        nonlocal removed
        removed = names.pop(canonical_name, "")

    names = _update_agent_names(session_name, update)
    return removed, names
