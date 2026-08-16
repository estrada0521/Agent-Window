from __future__ import annotations

import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from agent_window_lib.state import _parse_tmux_environment_output
from backend_core.tmux.control import stop_chat_server as stop_session_chat_server


def _clean_tmux_env_value(value: str) -> str:
    cleaned = (value or "").strip()
    if cleaned == "-":
        return ""
    return cleaned


def session_context_from_env_output(tmux_env_output: str) -> dict[str, str]:
    env_map = _parse_tmux_environment_output(tmux_env_output)
    return {
        "workspace": _clean_tmux_env_value(env_map.get("AGENT_WINDOW_WORKSPACE", "")),
        "tmux_socket": _clean_tmux_env_value(env_map.get("AGENT_WINDOW_TMUX_SOCKET", "")),
    }
