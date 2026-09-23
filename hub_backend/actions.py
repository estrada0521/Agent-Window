from __future__ import annotations

import json
import time
from urllib.parse import parse_qs

from backend_core.access.session_meta import (
    SessionMetaError,
    rename_session,
    reset_session_agents,
    session_workspace,
    set_session_workspace,
)
from backend_core.access.settings import agent_window_session_root
from hub_backend.chat_supervisor import (
    TmuxUnhealthy,
    delete_archived_session,
    ensure_chat_server,
    kill_repo_session,
    revive_archived_session,
)
from hub_backend.session_api import resolve_session_chat_target
from hub_backend.session_query import active_session_records_query


def _session_query(parsed) -> tuple[str, str]:
    qs = parse_qs(parsed.query)
    return (qs.get("session", [""])[0] or "").strip(), qs.get("format", [""])[0]


def _fail(handler, ctx, fmt: str, status: int, message: str) -> None:
    if fmt == "json":
        handler._send_json(status, {"ok": False, "error": message})
    else:
        handler._send_html(status, ctx["error_page_fn"](message))


def _open_chat(handler, ctx, fmt: str, chat_port: int) -> None:
    location = ctx["format_chat_url_fn"](chat_port, f"/?ts={int(time.time() * 1000)}")
    if fmt == "json":
        handler._send_json(200, {"ok": True, "chat_url": location})
    else:
        handler._redirect(location)


def _back_to_hub(handler, fmt: str, session_name: str, action: str) -> None:
    if fmt == "json":
        handler._send_json(200, {"ok": True, "session": session_name, "action": action})
    else:
        handler._redirect("/")


def get_open_session(handler, parsed, ctx) -> None:
    session_name, fmt = _session_query(parsed)
    if not session_name:
        _fail(handler, ctx, fmt, 404, "That session is not available in this repo.")
        return
    resolved = resolve_session_chat_target(ctx["hub"], session_name)
    if resolved["status"] == "unhealthy":
        handler._send_unhealthy(fmt, resolved["detail"])
        return
    if resolved["status"] == "missing":
        _fail(handler, ctx, fmt, 404, "That session is not available in this repo.")
        return
    if resolved["status"] != "ok":
        _fail(handler, ctx, fmt, 500, f"Failed to start chat for {session_name}: {resolved['detail']}")
        return
    _open_chat(handler, ctx, fmt, resolved["chat_port"])


def get_revive_session(handler, parsed, ctx) -> None:
    session_name, fmt = _session_query(parsed)
    if not session_name:
        _fail(handler, ctx, fmt, 404, "That archived session is not available in this repo.")
        return
    try:
        ok, detail = revive_archived_session(ctx["hub"], session_name)
    except TmuxUnhealthy as exc:
        handler._send_unhealthy(fmt, str(exc))
        return
    if not ok:
        _fail(handler, ctx, fmt, 500, f"Failed to revive {session_name}: {detail}")
        return
    workspace = active_session_records_query(ctx["hub"]).records[session_name]["workspace"]
    ok, chat_port, detail = ensure_chat_server(ctx["hub"], expected_active=True, workspace=workspace)
    if not ok:
        _fail(handler, ctx, fmt, 500, f"Failed to start chat for {session_name}: {detail}")
        return
    _open_chat(handler, ctx, fmt, chat_port)


def get_kill_session(handler, parsed, ctx) -> None:
    session_name, fmt = _session_query(parsed)
    if not session_name:
        _fail(handler, ctx, fmt, 404, "That active session is not available in this repo.")
        return
    try:
        ok, detail = kill_repo_session(ctx["hub"], session_name)
    except TmuxUnhealthy as exc:
        handler._send_unhealthy(fmt, str(exc))
        return
    if not ok:
        _fail(handler, ctx, fmt, 500, f"Failed to kill {session_name}: {detail}")
        return
    _back_to_hub(handler, fmt, session_name, "killed")


def get_delete_archived_session(handler, parsed, ctx) -> None:
    session_name, fmt = _session_query(parsed)
    if not session_name:
        _fail(handler, ctx, fmt, 404, "That archived session is not available in this repo.")
        return
    try:
        ok, detail = delete_archived_session(ctx["hub"], session_name)
    except TmuxUnhealthy as exc:
        handler._send_unhealthy(fmt, str(exc))
        return
    if not ok:
        _fail(handler, ctx, fmt, 500, f"Failed to delete archived session {session_name}: {detail}")
        return
    _back_to_hub(handler, fmt, session_name, "deleted")


def get_session_workspace(handler, parsed, _ctx) -> None:
    qs = parse_qs(parsed.query)
    session_name = (qs.get("session", [""])[0] or "").strip()
    if not session_name:
        handler._send_json(404, {"ok": False, "error": "Session not found"})
        return
    try:
        workspace = session_workspace(session_name)
    except SessionMetaError:
        handler._send_json(404, {"ok": False, "error": "Session not found"})
        return
    handler._send_json(200, {"ok": True, "session": session_name, "workspace": workspace})


def post_restart_hub(handler, _parsed, ctx) -> None:
    ok, detail, owns_restart = ctx["queue_hub_restart_fn"]()
    body = json.dumps(
        {"ok": ok, "error": "" if ok else detail},
        ensure_ascii=True,
    ).encode("utf-8")
    try:
        handler.send_response(200 if ok else 503)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
        handler.wfile.flush()
    finally:
        if owns_restart:
            ctx["release_restart_hold_fn"]()


def post_rename_session(handler, _parsed, _ctx) -> None:
    data = handler._read_form()
    old_name = str(data.get("old_name") or "").strip()
    new_name = str(data.get("new_name") or "").strip()
    if any(not name or name in {".", ".."} or "/" in name or "\0" in name for name in (old_name, new_name)):
        handler._send_json(409, {"ok": False, "error": "Session name is not a valid folder name."})
        return
    source = agent_window_session_root() / old_name
    target = agent_window_session_root() / new_name
    if not source.is_dir():
        handler._send_json(409, {"ok": False, "error": f"Session not found: {old_name}"})
        return
    if old_name != new_name and (target.exists() or target.is_symlink()):
        handler._send_json(409, {"ok": False, "error": f"A session named {new_name} already exists."})
        return
    try:
        if old_name != new_name:
            rename_session(old_name, new_name)
    except OSError as exc:
        handler._send_json(409, {"ok": False, "error": str(exc)})
        return
    handler._send_json(200, {"ok": True, "old_name": old_name, "new_name": new_name})


def post_change_session_workspace(handler, _parsed, _ctx) -> None:
    data = handler._read_form()
    session_name = str(data.get("session") or "").strip()
    workspace = str(data.get("workspace") or "").strip()
    try:
        set_session_workspace(session_name, workspace)
    except SessionMetaError as exc:
        handler._send_json(409, {"ok": False, "error": str(exc)})
        return
    handler._send_json(200, {"ok": True, "session": session_name, "workspace": workspace})


def post_reset_session_agents(handler, _parsed, _ctx) -> None:
    data = handler._read_form()
    session_name = str(data.get("session") or "").strip()
    try:
        reset_session_agents(session_name)
    except SessionMetaError as exc:
        handler._send_json(409, {"ok": False, "error": str(exc)})
        return
    handler._send_json(200, {"ok": True, "session": session_name})
