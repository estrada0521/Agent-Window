from __future__ import annotations

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from server.runtime import ChatRuntime


def load_runtime_events_for_idle_running(runtime: ChatRuntime, agent: str) -> list[dict]:
    if agent not in runtime._gemini_cursors:
        return []
    path = runtime._gemini_cursors[agent].path
    if not path or not os.path.exists(path):
        return []
    return []
