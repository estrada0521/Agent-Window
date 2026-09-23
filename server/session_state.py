from __future__ import annotations

import os

from backend_core.access.session_meta import session_meta_agents


def build_session_state_payload(
    runtime,
    *,
    server_instance: str,
    session_name: str,
) -> dict:
    return {
        "server_instance": server_instance,
        "pid": os.getpid(),
        "session": session_name,
        "active": bool(runtime.session_is_active),
        "workspace": str(runtime.workspace or ""),
        "repo_root": str(runtime.repo_root or ""),
        "targets": (
            runtime.active_agents()
            if runtime.session_is_active
            else session_meta_agents(session_name)
        ),
        "statuses": runtime.agent_statuses(),
        "agent_runtime": runtime.agent_runtime_state(),
    }
