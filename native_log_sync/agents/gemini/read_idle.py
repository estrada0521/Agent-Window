from __future__ import annotations

import os
from typing import TYPE_CHECKING

from native_log_sync.agents.gemini.read_runtime import parse_antigravity_db_runtime

if TYPE_CHECKING:
    from server.runtime import ChatRuntime


def load_runtime_events_for_idle_running(runtime: ChatRuntime, agent: str) -> list[dict]:
    path = runtime._native_log_current_paths.get(agent)
    if not path:
        return []
    if not path or not os.path.exists(path):
        return []
    return parse_antigravity_db_runtime(path, limit=12, workspace=runtime.workspace) or []
