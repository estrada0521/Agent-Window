from __future__ import annotations

from typing import Any

from shortcut_command.catalog import PANE_CONTROL_COMMAND_IDS
from shortcut_command.control import try_deliver_shortcut_control


def run_shortcut_command(
    rt: Any,
    *,
    command_id: str,
    arg: str,
    target: str,
) -> tuple[int, dict[str, Any]]:
    normalized_command_id = (command_id or "").strip().lower()
    if normalized_command_id not in PANE_CONTROL_COMMAND_IDS:
        msg = "unknown shortcut command"
        return 400, {"ok": False, "error": msg, "status_message": msg}
    resolved = (target or "").strip()
    if not resolved:
        msg = "target is required"
        return 400, {"ok": False, "error": msg, "status_message": msg}

    if normalized_command_id == "terminal" and not (arg or "").strip():
        msg = "text is required"
        return 400, {"ok": False, "error": msg, "status_message": msg}

    wire = _wire_payload(normalized_command_id, arg)
    out = try_deliver_shortcut_control(rt, resolved, normalized_command_id, wire)
    if out is None:
        msg = "shortcut dispatch failed"
        return 500, {"ok": False, "error": msg, "status_message": msg}
    return out


def _wire_payload(command_id: str, arg: str) -> str:
    if command_id in {"up", "down", "left", "right"}:
        n = _parse_repeat(arg, default=1)
        return f"{command_id} {n}"
    if command_id == "terminal":
        return arg
    return command_id


def _parse_repeat(arg: str, *, default: int) -> int:
    raw = (arg or "").strip() or str(default)
    try:
        n = int(raw, 10)
    except ValueError:
        n = default
    return max(1, min(n, 100))
