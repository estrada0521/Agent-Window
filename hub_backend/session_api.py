from __future__ import annotations

from backend_core.access.settings import workspace_chat_port
from hub_backend.chat_supervisor import ensure_chat_server
from hub_backend.session_query import active_session_records_query, archived_session_records


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
    return {
        "status": "ok",
        "chat_port": chat_port,
        "workspace": workspace,
        "session_is_active": session_is_active,
    }


def resolve_session_chat_target(hub, session_name: str) -> dict:
    query = active_session_records_query(hub)
    if session_name in query.records:
        record = query.records[session_name]
        workspace = str(record.get("workspace") or "").strip()
        return _chat_target(hub, workspace, session_is_active=True)
    if query.state == "unhealthy":
        return {"status": "unhealthy", "detail": query.detail}
    archived = archived_session_records(query.non_archived_names)
    record = archived.get(session_name)
    if not record:
        return {"status": "missing"}
    workspace = str(record.get("workspace") or "").strip()
    return _chat_target(hub, workspace, session_is_active=False)


def resolve_session_chat_target_by_port(hub, chat_port: int) -> dict:
    port = int(chat_port)
    query = active_session_records_query(hub)
    for record in query.records.values():
        workspace = str(record.get("workspace") or "").strip()
        if workspace and workspace_chat_port(workspace) == port:
            return _chat_target(hub, workspace, session_is_active=True)
    if query.state == "unhealthy":
        return {"status": "unhealthy", "detail": query.detail}
    archived = archived_session_records(query.non_archived_names)
    for record in archived.values():
        workspace = str(record.get("workspace") or "").strip()
        if workspace and workspace_chat_port(workspace) == port:
            return _chat_target(hub, workspace, session_is_active=False)
    return {"status": "missing"}
