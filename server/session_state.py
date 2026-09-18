from __future__ import annotations

import os
import threading
import time

from backend_core.access.session_meta import session_meta_agents


def initialize_session_state_bus(runtime) -> None:
    runtime._session_state_condition = threading.Condition()
    runtime._session_state_seq = 0


def publish_session_state_change(runtime) -> None:
    with runtime._session_state_condition:
        runtime._session_state_seq += 1
        runtime._session_state_condition.notify_all()


def wait_for_session_state_change(runtime, after_seq: int, timeout: float = 15.0) -> dict | None:
    deadline = time.monotonic() + max(0.1, float(timeout))
    with runtime._session_state_condition:
        while runtime._session_state_seq <= after_seq:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            runtime._session_state_condition.wait(timeout=remaining)
        return {"seq": runtime._session_state_seq}


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
