from __future__ import annotations

import json
import time
from urllib.parse import parse_qs

from fs.log.meta import (
    LogMetaError,
    rename_log,
    reset_log_agents,
    log_workspace,
    set_log_workspace,
)
from fs.log.jsonl import append_jsonl_entry
from fs.log.paths import agent_window_log_root, log_jsonl_path
from server.hub.room_supervisor import (
    TmuxUnhealthy,
    delete_archived_timeline,
    ensure_room_server,
    request_room_archive,
    request_room_revive,
)
from server.hub.timeline_api import resolve_timeline_room_target


def _timeline_query(parsed) -> tuple[str, str]:
    qs = parse_qs(parsed.query)
    return (qs.get("timeline", [""])[0] or "").strip(), qs.get("format", [""])[0]


def _fail(handler, ctx, fmt: str, status: int, message: str) -> None:
    if fmt == "json":
        handler._send_json(status, {"ok": False, "error": message})
    else:
        handler._send_html(status, ctx["error_page_fn"](message))


def _open_room(handler, ctx, fmt: str, room_port: int) -> None:
    location = ctx["format_room_url_fn"](room_port, f"/?ts={int(time.time() * 1000)}")
    if fmt == "json":
        handler._send_json(200, {"ok": True, "room_url": location})
    else:
        handler._redirect(location)


def _back_to_hub(handler, fmt: str, timeline_label: str, action: str) -> None:
    if fmt == "json":
        handler._send_json(200, {"ok": True, "timeline": timeline_label, "action": action})
    else:
        handler._redirect("/")


def get_open_timeline(handler, parsed, ctx) -> None:
    timeline_label, fmt = _timeline_query(parsed)
    if not timeline_label:
        _fail(handler, ctx, fmt, 404, "That timeline is not available in this repo.")
        return
    resolved = resolve_timeline_room_target(ctx["hub"], timeline_label)
    if resolved["status"] == "unhealthy":
        handler._send_unhealthy(fmt, resolved["detail"])
        return
    if resolved["status"] == "missing":
        _fail(handler, ctx, fmt, 404, "That timeline is not available in this repo.")
        return
    if resolved["status"] != "ok":
        _fail(handler, ctx, fmt, 500, f"Failed to start room for {timeline_label}: {resolved['detail']}")
        return
    _open_room(handler, ctx, fmt, resolved["room_port"])


def get_revive_room(handler, parsed, ctx) -> None:
    timeline_label, fmt = _timeline_query(parsed)
    if not timeline_label:
        _fail(handler, ctx, fmt, 404, "That archived timeline is not available in this repo.")
        return
    try:
        ok, detail = request_room_revive(ctx["hub"], timeline_label)
    except TmuxUnhealthy as exc:
        handler._send_unhealthy(fmt, str(exc))
        return
    if not ok:
        _fail(handler, ctx, fmt, 500, f"Failed to revive {timeline_label}: {detail}")
        return
    ctx["hub"].publish_timeline_messages_changed()
    workspace = log_workspace(timeline_label)
    ok, room_port, detail = ensure_room_server(ctx["hub"], expected_active=True, workspace=workspace)
    if not ok:
        _fail(handler, ctx, fmt, 500, f"Failed to start room for {timeline_label}: {detail}")
        return
    _open_room(handler, ctx, fmt, room_port)


def get_archive_room(handler, parsed, ctx) -> None:
    timeline_label, fmt = _timeline_query(parsed)
    if not timeline_label:
        _fail(handler, ctx, fmt, 404, "That active timeline is not available in this repo.")
        return
    try:
        ok, detail = request_room_archive(ctx["hub"], timeline_label)
    except TmuxUnhealthy as exc:
        handler._send_unhealthy(fmt, str(exc))
        return
    if not ok:
        _fail(handler, ctx, fmt, 500, f"Failed to kill {timeline_label}: {detail}")
        return
    ctx["hub"].publish_timeline_messages_changed()
    _back_to_hub(handler, fmt, timeline_label, "killed")


def get_delete_archived_timeline(handler, parsed, ctx) -> None:
    timeline_label, fmt = _timeline_query(parsed)
    if not timeline_label:
        _fail(handler, ctx, fmt, 404, "That archived timeline is not available in this repo.")
        return
    try:
        ok, detail = delete_archived_timeline(ctx["hub"], timeline_label)
    except TmuxUnhealthy as exc:
        handler._send_unhealthy(fmt, str(exc))
        return
    if not ok:
        _fail(handler, ctx, fmt, 500, f"Failed to delete archived timeline {timeline_label}: {detail}")
        return
    ctx["hub"].publish_timeline_messages_changed()
    _back_to_hub(handler, fmt, timeline_label, "deleted")


def get_timeline_workspace(handler, parsed, _ctx) -> None:
    qs = parse_qs(parsed.query)
    timeline_label = (qs.get("timeline", [""])[0] or "").strip()
    if not timeline_label:
        handler._send_json(404, {"ok": False, "error": "Timeline not found"})
        return
    try:
        workspace = log_workspace(timeline_label)
    except LogMetaError:
        handler._send_json(404, {"ok": False, "error": "Timeline not found"})
        return
    handler._send_json(200, {"ok": True, "timeline": timeline_label, "workspace": workspace})


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
        handler._send_json(409, {"ok": False, "error": "Timeline label is not a valid folder name."})
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
    timeline_label = str(data.get("timeline") or "").strip()
    workspace = str(data.get("workspace") or "").strip()
    try:
        set_log_workspace(timeline_label, workspace)
    except LogMetaError as exc:
        handler._send_json(409, {"ok": False, "error": str(exc)})
        return
    ctx["hub"].publish_timeline_messages_changed()
    handler._send_json(200, {"ok": True, "timeline": timeline_label, "workspace": workspace})


def post_reset_timeline_agents(handler, _parsed, ctx) -> None:
    data = handler._read_form()
    timeline_label = str(data.get("timeline") or "").strip()
    try:
        reset_log_agents(timeline_label)
    except LogMetaError as exc:
        handler._send_json(409, {"ok": False, "error": str(exc)})
        return
    ctx["hub"].publish_timeline_messages_changed()
    handler._send_json(200, {"ok": True, "timeline": timeline_label})
