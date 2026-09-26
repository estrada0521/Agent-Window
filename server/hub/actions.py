from __future__ import annotations

import json
import time
from urllib.parse import parse_qs

from fs.log.meta import (
    LogMetaError,
    read_log_meta,
    rename_log,
    reset_log_agents,
    log_workspace,
    set_log_workspace,
)
from fs.log.jsonl import append_jsonl_entry
from fs.log.paths import agent_window_log_root, log_jsonl_path
from server.hub.supervisor import (
    TmuxUnhealthy,
    delete_archived_timeline,
    ensure_timeline_server,
    archive_timeline,
    revive_timeline,
)
from server.hub.timeline_query import live_timelines_query


def _timeline_target(hub, workspace: str, *, session_is_active: bool) -> dict:
    ok, timeline_port, detail = ensure_timeline_server(
        hub,
        expected_active=session_is_active,
        workspace=workspace,
    )
    if not ok:
        return {"status": "error", "detail": detail}
    return {"status": "ok", "timeline_port": timeline_port}


def resolve_timeline_target(hub, timeline_name: str) -> dict:
    live = live_timelines_query(hub)
    if timeline_name in live.workspaces:
        return _timeline_target(hub, live.workspaces[timeline_name], session_is_active=True)
    if live.state == "unhealthy":
        return {"status": "unhealthy", "detail": live.detail}
    try:
        workspace = read_log_meta(timeline_name)["workspace"]
    except FileNotFoundError:
        return {"status": "missing"}
    return _timeline_target(hub, workspace, session_is_active=False)


def _timeline_query(parsed) -> tuple[str, str]:
    qs = parse_qs(parsed.query)
    return (qs.get("timeline", [""])[0] or "").strip(), qs.get("format", [""])[0]


def _fail(handler, ctx, fmt: str, status: int, message: str) -> None:
    if fmt == "json":
        handler._send_json(status, {"ok": False, "error": message})
    else:
        handler._send_html(status, ctx["error_page_fn"](message))


def _open_timeline(handler, ctx, fmt: str, timeline_port: int) -> None:
    location = ctx["format_timeline_url_fn"](timeline_port, f"/?ts={int(time.time() * 1000)}")
    if fmt == "json":
        handler._send_json(200, {"ok": True, "timeline_url": location})
    else:
        handler._redirect(location)


def _back_to_hub(handler, fmt: str, timeline_name: str, action: str) -> None:
    if fmt == "json":
        handler._send_json(200, {"ok": True, "timeline": timeline_name, "action": action})
    else:
        handler._redirect("/")


def get_open_timeline(handler, parsed, ctx) -> None:
    timeline_name, fmt = _timeline_query(parsed)
    if not timeline_name:
        _fail(handler, ctx, fmt, 404, "That timeline is not available in this repo.")
        return
    resolved = resolve_timeline_target(ctx["hub"], timeline_name)
    if resolved["status"] == "unhealthy":
        handler._send_unhealthy(fmt, resolved["detail"])
        return
    if resolved["status"] == "missing":
        _fail(handler, ctx, fmt, 404, "That timeline is not available in this repo.")
        return
    if resolved["status"] != "ok":
        _fail(handler, ctx, fmt, 500, f"Failed to start timeline server for {timeline_name}: {resolved['detail']}")
        return
    _open_timeline(handler, ctx, fmt, resolved["timeline_port"])


def get_revive_timeline(handler, parsed, ctx) -> None:
    timeline_name, fmt = _timeline_query(parsed)
    if not timeline_name:
        _fail(handler, ctx, fmt, 404, "That archived timeline is not available in this repo.")
        return
    try:
        ok, detail = revive_timeline(ctx["hub"], timeline_name)
    except TmuxUnhealthy as exc:
        handler._send_unhealthy(fmt, str(exc))
        return
    if not ok:
        _fail(handler, ctx, fmt, 500, f"Failed to revive {timeline_name}: {detail}")
        return
    ctx["hub"].publish_timeline_messages_changed()
    workspace = log_workspace(timeline_name)
    ok, timeline_port, detail = ensure_timeline_server(ctx["hub"], expected_active=True, workspace=workspace)
    if not ok:
        _fail(handler, ctx, fmt, 500, f"Failed to start timeline server for {timeline_name}: {detail}")
        return
    _open_timeline(handler, ctx, fmt, timeline_port)


def get_archive_timeline(handler, parsed, ctx) -> None:
    timeline_name, fmt = _timeline_query(parsed)
    if not timeline_name:
        _fail(handler, ctx, fmt, 404, "That active timeline is not available in this repo.")
        return
    try:
        ok, detail = archive_timeline(ctx["hub"], timeline_name)
    except TmuxUnhealthy as exc:
        handler._send_unhealthy(fmt, str(exc))
        return
    if not ok:
        _fail(handler, ctx, fmt, 500, f"Failed to kill {timeline_name}: {detail}")
        return
    ctx["hub"].publish_timeline_messages_changed()
    _back_to_hub(handler, fmt, timeline_name, "killed")


def get_delete_archived_timeline(handler, parsed, ctx) -> None:
    timeline_name, fmt = _timeline_query(parsed)
    if not timeline_name:
        _fail(handler, ctx, fmt, 404, "That archived timeline is not available in this repo.")
        return
    try:
        ok, detail = delete_archived_timeline(ctx["hub"], timeline_name)
    except TmuxUnhealthy as exc:
        handler._send_unhealthy(fmt, str(exc))
        return
    if not ok:
        _fail(handler, ctx, fmt, 500, f"Failed to delete archived timeline {timeline_name}: {detail}")
        return
    ctx["hub"].publish_timeline_messages_changed()
    _back_to_hub(handler, fmt, timeline_name, "deleted")


def get_timeline_workspace(handler, parsed, _ctx) -> None:
    qs = parse_qs(parsed.query)
    timeline_name = (qs.get("timeline", [""])[0] or "").strip()
    if not timeline_name:
        handler._send_json(404, {"ok": False, "error": "Timeline not found"})
        return
    try:
        workspace = log_workspace(timeline_name)
    except LogMetaError:
        handler._send_json(404, {"ok": False, "error": "Timeline not found"})
        return
    handler._send_json(200, {"ok": True, "timeline": timeline_name, "workspace": workspace})


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


def post_rename_timeline(handler, _parsed, ctx) -> None:
    data = handler._read_form()
    old_name = str(data.get("old_name") or "").strip()
    new_name = str(data.get("new_name") or "").strip()
    if any(not name or name in {".", ".."} or "/" in name or "\0" in name for name in (old_name, new_name)):
        handler._send_json(409, {"ok": False, "error": "Timeline name is not a valid folder name."})
        return
    source = agent_window_log_root() / old_name
    target = agent_window_log_root() / new_name
    if not source.is_dir():
        handler._send_json(409, {"ok": False, "error": f"Timeline not found: {old_name}"})
        return
    if old_name != new_name and (target.exists() or target.is_symlink()):
        handler._send_json(409, {"ok": False, "error": f"A timeline labeled {new_name} already exists."})
        return
    try:
        if old_name != new_name:
            rename_log(old_name, new_name)
            append_jsonl_entry(
                log_jsonl_path(new_name),
                {
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "sender": "system",
                    "targets": [],
                    "message": f"Timeline renamed: {old_name} → {new_name}",
                },
            )
    except OSError as exc:
        handler._send_json(409, {"ok": False, "error": str(exc)})
        return
    ctx["hub"].publish_timeline_messages_changed()
    handler._send_json(200, {"ok": True, "old_name": old_name, "new_name": new_name})


def post_change_timeline_workspace(handler, _parsed, ctx) -> None:
    data = handler._read_form()
    timeline_name = str(data.get("timeline") or "").strip()
    workspace = str(data.get("workspace") or "").strip()
    try:
        set_log_workspace(timeline_name, workspace)
    except LogMetaError as exc:
        handler._send_json(409, {"ok": False, "error": str(exc)})
        return
    ctx["hub"].publish_timeline_messages_changed()
    handler._send_json(200, {"ok": True, "timeline": timeline_name, "workspace": workspace})


def post_reset_timeline_agents(handler, _parsed, ctx) -> None:
    data = handler._read_form()
    timeline_name = str(data.get("timeline") or "").strip()
    try:
        reset_log_agents(timeline_name)
    except LogMetaError as exc:
        handler._send_json(409, {"ok": False, "error": str(exc)})
        return
    ctx["hub"].publish_timeline_messages_changed()
    handler._send_json(200, {"ok": True, "timeline": timeline_name})
