from __future__ import annotations

import re
import subprocess
from typing import Any

from tmux import TMUX
from tmux.send_keys import deliver_text_to_pane

PANE_KEY_MACROS = frozenset({"up", "down", "left", "right", "enter", "esc", "ctrlc"})
PANE_TEXT_MACROS = ("/model", "/effort", "/usage", "/permission", "/resume")
PANE_FUNCTION_KEYS = tuple(f"F{i}" for i in range(1, 13))
TERMINAL_INPUT = "terminal"
KEY_MACRO_IDS = PANE_KEY_MACROS | frozenset(PANE_TEXT_MACROS) | frozenset(key.lower() for key in PANE_FUNCTION_KEYS) | {TERMINAL_INPUT}
_SINGLE_KEYS = {"esc": "Escape", "ctrlc": "C-c", "enter": "Enter"}
_ARROW_KEYS = {"up": "Up", "down": "Down", "left": "Left", "right": "Right"}


def run_key_macro(
    *,
    agent_panes: dict[str, str],
    terminal_pane: str,
    macro_id: str,
    arg: str,
    target: str,
) -> tuple[int, dict[str, Any]]:
    macro_id = (macro_id or "").strip().lower()
    if not (target or "").strip():
        return 400, {"ok": False, "error": "target is required"}
    if macro_id not in KEY_MACRO_IDS:
        return 400, {"ok": False, "error": "unknown key macro"}
    if macro_id == TERMINAL_INPUT and not (arg or "").strip():
        return 400, {"ok": False, "error": "text is required"}
    arrow = _arrow_repeat(macro_id, arg)
    try:
        for target_item in [item.strip() for item in target.split(",") if item.strip()]:
            pane_id = terminal_pane if target_item == TERMINAL_INPUT else agent_panes.get(target_item, "")
            if not pane_id:
                return 400, {"ok": False, "error": f"pane not found for {target_item}"}
            if macro_id in PANE_TEXT_MACROS or macro_id == TERMINAL_INPUT:
                text = arg if macro_id == TERMINAL_INPUT else macro_id
                if not deliver_text_to_pane(_run_tmux, pane_id, text):
                    return 400, {"ok": False, "error": f"send-keys failed for {target_item}"}
                continue
            key = macro_id.upper() if macro_id.startswith("f") else (_ARROW_KEYS[macro_id] if arrow else _SINGLE_KEYS[macro_id])
            for _ in range(arrow or 1):
                result = _run_tmux(["send-keys", "-t", pane_id, key])
                if result.returncode != 0:
                    detail = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip()
                    return 400, {"ok": False, "error": detail or f"send-keys failed for {target_item}"}
    except Exception as exc:
        return 500, {"ok": False, "error": str(exc)}
    return 200, {"ok": True}


def _run_tmux(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([*TMUX, *args], capture_output=True, check=False)


def _arrow_repeat(macro_id: str, arg: str) -> int:
    if macro_id not in _ARROW_KEYS:
        return 0
    raw = (arg or "").strip()
    if not re.fullmatch(r"\d+", raw):
        return 1
    return max(1, min(int(raw), 100))
