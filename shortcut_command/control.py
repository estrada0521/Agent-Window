from __future__ import annotations

import logging
import os
import subprocess
from typing import Any, Protocol

from message_delivery.paste import deliver_text_to_pane
from shortcut_command.catalog import PANE_SINGLE_CONTROL_MESSAGES, PANE_TEXT_MACROS
from shortcut_command.parsing import parse_pane_direct_command


class ShortcutControlRuntime(Protocol):
    tmux_prefix: list[str]

    def restart_agent_pane(self, agent: str) -> tuple[bool, str]: ...

    def resume_agent_pane(self, agent: str) -> tuple[bool, str]: ...

    def pane_id_for_control_target(self, target: str) -> str | None: ...

    def _mark_idle(self, agent: str) -> None: ...

    def append_system_entry(self, message: str, *, agent: str = "", **extra: Any) -> dict: ...


def try_deliver_shortcut_control(
    rt: ShortcutControlRuntime,
    target: str,
    message: str,
) -> tuple[int, dict] | None:
    pane_direct = parse_pane_direct_command(message)
    text_macro = message if message in PANE_TEXT_MACROS else ""
    if message not in PANE_SINGLE_CONTROL_MESSAGES and not pane_direct and not text_macro:
        return None
    if not target:
        return 400, {"ok": False, "error": "target is required"}
    control_targets = [item.strip() for item in target.split(",") if item.strip()]
    def run_tmux(args):
        return subprocess.run(
            [*rt.tmux_prefix, *args],
            capture_output=True,
            check=False,
        )
    try:
        for target_item in control_targets:
            if message == "restart":
                ok, detail = rt.restart_agent_pane(target_item)
                if not ok:
                    return 400, {"ok": False, "error": detail}
                continue
            if message == "resume":
                ok, detail = rt.resume_agent_pane(target_item)
                if not ok:
                    return 400, {"ok": False, "error": detail}
                continue
            pane_id = rt.pane_id_for_control_target(target_item)
            if not pane_id:
                return 400, {"ok": False, "error": f"pane not found for {target_item}"}
            if text_macro:
                if not deliver_text_to_pane(run_tmux, pane_id, text_macro, env=os.environ):
                    return 400, {"ok": False, "error": f"send-keys failed for {target_item}"}
                continue
            if pane_direct:
                tmux_key = {"up": "Up", "down": "Down", "left": "Left", "right": "Right"}[pane_direct["name"]]
                for _ in range(pane_direct["repeat"]):
                    result = subprocess.run(
                        [*rt.tmux_prefix, "send-keys", "-t", pane_id, tmux_key],
                        capture_output=True,
                        check=False,
                    )
                    if result.returncode != 0:
                        detail = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip()
                        return 400, {"ok": False, "error": detail or f"send-keys failed for {target_item}"}
                continue
            tmux_key = {"esc": "Escape", "ctrlc": "C-c", "enter": "Enter"}[message]
            result = subprocess.run(
                [*rt.tmux_prefix, "send-keys", "-t", pane_id, tmux_key],
                capture_output=True,
                check=False,
            )
            if result.returncode != 0:
                detail = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip()
                return 400, {"ok": False, "error": detail or f"send-keys failed for {target_item}"}
            if message in {"esc", "ctrlc"}:
                rt._mark_idle(target_item)
    except Exception as exc:
        logging.error("Unexpected error: %s", exc, exc_info=True)
        return 500, {"ok": False, "error": str(exc)}
    if message in {"restart", "resume"} and control_targets:
        action = "Restarted" if message == "restart" else "Resumed"
        rt.append_system_entry(
            f"{action}: {', '.join(control_targets)}",
            kind="agent-control",
            command=message,
            targets=control_targets,
        )
    mode = pane_direct["name"] if pane_direct else message
    return 200, {"ok": True, "mode": mode, "status_message": _status_completed(mode, control_targets)}


def _status_completed(mode: str, control_targets: list[str]) -> str:
    scope = ", ".join(control_targets) if control_targets else ""
    tail = f" ({scope})" if scope else ""
    return f"{mode} completed{tail}"
