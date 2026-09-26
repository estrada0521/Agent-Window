from __future__ import annotations

import subprocess
from typing import Any, Protocol
from tmux import TMUX
from tmux.lifecycle import restart_agent_pane
from tmux.send_keys import deliver_text_to_pane
from tmux.shortcut_command.catalog import PANE_SINGLE_CONTROL_MESSAGES, PANE_TEXT_MACROS
import re


class ShortcutControlRuntime(Protocol):
    def pane_id_for_control_target(self, target: str) -> str | None: ...

    def append_system_entry(self, message: str, *, agent: str = "", **extra: Any) -> dict: ...


def try_deliver_shortcut_control(
    rt: ShortcutControlRuntime,
    target: str,
    command_id: str,
    message: str,
) -> tuple[int, dict] | None:
    pane_direct = parse_pane_direct_command(message)
    is_text_delivery = message in PANE_TEXT_MACROS or command_id == "terminal"
    if message not in PANE_SINGLE_CONTROL_MESSAGES and not pane_direct and not is_text_delivery:
        return None
    if not target:
        return 400, {"ok": False, "error": "target is required"}
    control_targets = [item.strip() for item in target.split(",") if item.strip()]
    def run_tmux(args):
        return subprocess.run(
            [*TMUX, *args],
            capture_output=True,
            check=False,
        )
    try:
        for target_item in control_targets:
            if message == "restart":
                ok, detail = restart_agent_pane(rt, target_item)
                if not ok:
                    return 400, {"ok": False, "error": detail}
                continue
            pane_id = rt.pane_id_for_control_target(target_item)
            if not pane_id:
                return 400, {"ok": False, "error": f"pane not found for {target_item}"}
            if is_text_delivery:
                if not deliver_text_to_pane(run_tmux, pane_id, message):
                    return 400, {"ok": False, "error": f"send-keys failed for {target_item}"}
                continue
            if pane_direct:
                tmux_key = {"up": "Up", "down": "Down", "left": "Left", "right": "Right"}[pane_direct["name"]]
                for _ in range(pane_direct["repeat"]):
                    result = subprocess.run(
                        [*TMUX, "send-keys", "-t", pane_id, tmux_key],
                        capture_output=True,
                        check=False,
                    )
                    if result.returncode != 0:
                        detail = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip()
                        return 400, {"ok": False, "error": detail or f"send-keys failed for {target_item}"}
                continue
            tmux_key = {"esc": "Escape", "ctrlc": "C-c", "enter": "Enter"}[message]
            result = subprocess.run(
                [*TMUX, "send-keys", "-t", pane_id, tmux_key],
                capture_output=True,
                check=False,
            )
            if result.returncode != 0:
                detail = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip()
                return 400, {"ok": False, "error": detail or f"send-keys failed for {target_item}"}
    except Exception as exc:
        return 500, {"ok": False, "error": str(exc)}
    if message == "restart" and control_targets:
        rt.append_system_entry(
            f"Restarted: {', '.join(control_targets)}",
            targets=control_targets,
        )
    return 200, {"ok": True}


def parse_pane_direct_command(message: str) -> dict | None:
    normalized = (message or "").strip().lower()
    match = re.fullmatch(r"(up|down|left|right)(?:\s+(\d+))?", normalized)
    if not match:
        return None
    repeat = max(1, min(int(match.group(2) or "1"), 100))
    return {"name": match.group(1), "repeat": repeat}
