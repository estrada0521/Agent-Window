from __future__ import annotations

from backend_core.access.session_meta import read_session_meta, session_workspace_claims
from backend_core.access.settings import workspace_chat_port
from hub_backend.chat_supervisor import ensure_chat_server
from hub_backend.session_query import live_sessions_query


def parse_chat_port(segment: str) -> int | None:
    try:
        port = int(segment)
    except (TypeError, ValueError):
        return None
    if port <= 0 or port > 65535:
        return None
    return port


def split_chat_proxy_path(path: str) -> tuple[int, str] | None:
    parts = str(path or "").split("/", 2)
    if len(parts) < 2:
        return None
    chat_port = parse_chat_port(parts[1])
    if chat_port is None:
        return None
    suffix = "/" if len(parts) < 3 or not parts[2] else f"/{parts[2]}"
    return chat_port, suffix


def _chat_target(hub, workspace: str, *, session_is_active: bool) -> dict:
    ok, chat_port, detail = ensure_chat_server(
        hub,
        expected_active=session_is_active,
        workspace=workspace,
    )
    if not ok:
        return {"status": "error", "detail": detail}
    return {"status": "ok", "chat_port": chat_port}


def resolve_session_chat_target(hub, session_name: str) -> dict:
    live = live_sessions_query(hub)
    if session_name in live.workspaces:
        return _chat_target(hub, live.workspaces[session_name], session_is_active=True)
    if live.state == "unhealthy":
        return {"status": "unhealthy", "detail": live.detail}
    try:
        workspace = read_session_meta(session_name)["workspace"]
    except FileNotFoundError:
        return {"status": "missing"}
    return _chat_target(hub, workspace, session_is_active=False)


def resolve_session_chat_target_by_port(hub, chat_port: int) -> dict:
    live = live_sessions_query(hub)
    for name, workspace in session_workspace_claims().values():
        if workspace_chat_port(workspace) != chat_port:
            continue
        if name in live.workspaces:
            return _chat_target(hub, workspace, session_is_active=True)
        if live.state == "unhealthy":
            return {"status": "unhealthy", "detail": live.detail}
        return _chat_target(hub, workspace, session_is_active=False)
    return {"status": "missing"}
