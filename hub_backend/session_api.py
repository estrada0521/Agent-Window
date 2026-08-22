from __future__ import annotations

from hub_backend.chat_supervisor import ensure_chat_server
from hub_backend.session_query import active_session_records_query, archived_session_records


def resolve_session_chat_target(hub, session_name: str) -> dict:
    query = active_session_records_query(hub)
    if session_name in query.records:
        record = query.records[session_name]
        workspace = str(record.get("workspace") or "").strip()
        ok, chat_port, detail = ensure_chat_server(hub, expected_active=True, workspace=workspace)
        if not ok:
            return {"status": "error", "detail": detail}
        return {
            "status": "ok",
            "chat_port": chat_port,
            "workspace": workspace,
            "session_is_active": True,
        }
    if query.state == "unhealthy":
        return {"status": "unhealthy", "detail": query.detail}
    archived = archived_session_records(query.non_archived_names)
    record = archived.get(session_name)
    if not record:
        return {"status": "missing"}
    workspace = str(record.get("workspace") or "").strip()
    ok, chat_port, detail = ensure_chat_server(hub, expected_active=False, workspace=workspace)
    if not ok:
        return {"status": "error", "detail": detail}
    return {
        "status": "ok",
        "chat_port": chat_port,
        "workspace": workspace,
        "session_is_active": False,
    }


def running_agents_from_session_state(session_state: dict | None) -> list[str]:
    if not isinstance(session_state, dict):
        return []
    statuses = session_state.get("statuses")
    if not isinstance(statuses, dict):
        return []
    return [
        str(agent).strip()
        for agent, status in statuses.items()
        if str(agent).strip() and str(status).strip().lower() == "running"
    ]
