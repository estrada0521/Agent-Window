from __future__ import annotations

from fs.session.meta import read_session_meta
from server.hub.room_supervisor import ensure_room_server
from server.hub.session_query import live_sessions_query


def parse_room_port(segment: str) -> int | None:
    try:
        port = int(segment)
    except (TypeError, ValueError):
        return None
    if port <= 0 or port > 65535:
        return None
    return port


def split_room_proxy_path(path: str) -> tuple[int, str] | None:
    parts = str(path or "").split("/", 2)
    if len(parts) < 2:
        return None
    room_port = parse_room_port(parts[1])
    if room_port is None:
        return None
    suffix = "/" if len(parts) < 3 or not parts[2] else f"/{parts[2]}"
    return room_port, suffix


def _room_target(hub, workspace: str, *, session_is_active: bool) -> dict:
    ok, room_port, detail = ensure_room_server(
        hub,
        expected_active=session_is_active,
        workspace=workspace,
    )
    if not ok:
        return {"status": "error", "detail": detail}
    return {"status": "ok", "room_port": room_port}


def resolve_session_room_target(hub, session_name: str) -> dict:
    live = live_sessions_query(hub)
    if session_name in live.workspaces:
        return _room_target(hub, live.workspaces[session_name], session_is_active=True)
    if live.state == "unhealthy":
        return {"status": "unhealthy", "detail": live.detail}
    try:
        workspace = read_session_meta(session_name)["workspace"]
    except FileNotFoundError:
        return {"status": "missing"}
    return _room_target(hub, workspace, session_is_active=False)
