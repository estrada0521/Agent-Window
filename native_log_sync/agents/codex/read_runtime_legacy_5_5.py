"""Retired Codex 5.5 native-log envelope support.

This module is deliberately not imported by the active runtime parser. Codex
5.6 uses ``custom_tool_call`` records (usually an outer ``exec`` call), while
5.5 emitted user-visible tools as direct ``function_call`` records. Keep this
tiny reader only as a reference for old archived logs; new behavior must not
be added here. A 5.6 log may still use ``function_call`` for quiet transport
polling such as ``wait``; the active parser intentionally does not display it.
"""

from __future__ import annotations


def iter_legacy_tool_calls(entry: dict) -> list[tuple[str, object]]:
    """Read the retired 5.5 ``function_call`` envelope."""

    if entry.get("type") != "response_item":
        return []
    payload = entry.get("payload") or {}
    if payload.get("type") != "function_call":
        return []
    return [(str(payload.get("name") or ""), payload.get("arguments", ""))]
