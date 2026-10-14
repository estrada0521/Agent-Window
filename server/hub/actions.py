from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.parse import parse_qs

from agents import agent_base_name
from agents.registry import AGENTS

from fs.log.meta import (
    LogMetaError,
    read_log_meta,
    rename_log,
    reset_log_agents,
    log_workspace,
    set_log_workspace,
)
from fs.log.jsonl import append_jsonl_entry
from fs.log.paths import agent_window_log_root, log_jsonl_path, workspace_timeline_path
from server.hub.timelines import (
    TmuxUnhealthy,
    delete_archived_timeline,
    archive_timeline,
    revive_timeline,
)
from server.hub.pages import error_page
from server.hub.timeline_query import live_timelines_query


def _timeline_query(parsed) -> tuple[str, str]:
    qs = parse_qs(parsed.query)
    return qs.get("timeline", [""])[0].strip(), qs.get("format", [""])[0]


def _fail(handler, fmt: str, status: int, message: str, *, detail: str = "") -> None:
    if detail:
        handler.log_error("%s: %s", message, detail)
    if fmt == "json":
        handler._send_json(status, {"ok": False, "error": message})
    else:
        handler._send_html(status, error_page(message))


def _open_timeline(handler, fmt: str, workspace: str) -> None:
    location = workspace_timeline_path(workspace) + f"/?ts={int(time.time() * 1000)}"
    if fmt == "json":
        handler._send_json(200, {"ok": True, "timeline_url": location})
    else:
        handler._redirect(location)


def _back_to_hub(handler, fmt: str, timeline_name: str, action: str) -> None:
    if fmt == "json":
        handler._send_json(200, {"ok": True, "timeline": timeline_name, "action": action})
    else:
        handler._redirect("/")


def post_open_timeline(handler, parsed, _ctx) -> None:
    timeline_name, fmt = _timeline_query(parsed)
    if not timeline_name:
        _fail(handler, fmt, 404, "That timeline is not available in this repo.")
        return
    try:
        workspace = read_log_meta(timeline_name)["workspace"]
    except FileNotFoundError:
        _fail(handler, fmt, 404, "That timeline is not available in this repo.")
        return
    _open_timeline(handler, fmt, workspace)


def post_revive_timeline(handler, parsed, ctx) -> None:
    timeline_name, fmt = _timeline_query(parsed)
    if not timeline_name:
        _fail(handler, fmt, 404, "That archived timeline is not available in this repo.")
        return
    try:
        ok, detail = revive_timeline(ctx["hub"], timeline_name)
    except TmuxUnhealthy as exc:
        handler._send_unhealthy(fmt, str(exc))
        return
    if not ok:
        if detail == "Workspace not found":
            _fail(handler, fmt, 404, detail)
        else:
            message = "Conversation unavailable · Reset Agents" if detail == "Conversation unavailable · Reset Agents" else "Revive failed"
            _fail(handler, fmt, 500, message, detail=f"{timeline_name}: {detail}")
        return
    ctx["hub"].publish_timeline_messages_changed()
    workspace = log_workspace(timeline_name)
    ctx["hub"].timeline(workspace)
    _open_timeline(handler, fmt, workspace)


def post_archive_timeline(handler, parsed, ctx) -> None:
    timeline_name, fmt = _timeline_query(parsed)
    if not timeline_name:
        _fail(handler, fmt, 404, "That active timeline is not available in this repo.")
        return
    try:
        ok, detail = archive_timeline(ctx["hub"], timeline_name)
    except TmuxUnhealthy as exc:
        handler._send_unhealthy(fmt, str(exc))
        return
    if not ok:
        _fail(handler, fmt, 500, "Failed to archive timeline", detail=f"{timeline_name}: {detail}")
        return
    ctx["hub"].publish_timeline_messages_changed()
    _back_to_hub(handler, fmt, timeline_name, "killed")


def post_delete_archived_timeline(handler, parsed, ctx) -> None:
    timeline_name, fmt = _timeline_query(parsed)
    if not timeline_name:
        _fail(handler, fmt, 404, "That archived timeline is not available in this repo.")
        return
    try:
        ok, detail = delete_archived_timeline(ctx["hub"], timeline_name)
    except TmuxUnhealthy as exc:
        handler._send_unhealthy(fmt, str(exc))
        return
    if not ok:
        _fail(handler, fmt, 500, "Failed to delete timeline", detail=f"{timeline_name}: {detail}")
        return
    ctx["hub"].publish_timeline_messages_changed()
    _back_to_hub(handler, fmt, timeline_name, "deleted")


def get_timeline_workspace(handler, parsed, _ctx) -> None:
    qs = parse_qs(parsed.query)
    timeline_name = qs.get("timeline", [""])[0].strip()
    if not timeline_name:
        handler._send_json(404, {"ok": False, "error": "Timeline not found"})
        return
    try:
        workspace = log_workspace(timeline_name)
    except LogMetaError:
        handler._send_json(404, {"ok": False, "error": "Timeline not found"})
        return
    handler._send_json(200, {"ok": True, "timeline": timeline_name, "workspace": workspace})


def _stats_sender_name(sender: str) -> str:
    base = agent_base_name(sender)
    if base == "user":
        return "User"
    if base in AGENTS:
        return AGENTS[base].display_name
    return "Others"


def _timeline_stats(log_path: Path) -> dict:
    created = ""
    updated = ""
    counts: dict[str, int] = {}
    with log_path.open(encoding="utf-8") as f:
        for line in f:
            entry = json.loads(line)
            updated = entry["timestamp"][:10]
            created = created or updated
            if entry["sender"] == "system":
                continue
            name = _stats_sender_name(entry["sender"])
            counts[name] = counts.get(name, 0) + 1
    others = counts.pop("Others", 0)
    user = counts.pop("User", 0)
    senders = [["User", user]] if user else []
    senders += sorted(counts.items(), key=lambda item: -item[1])
    senders += [["Others", others]] if others else []
    return {"created": created, "updated": updated, "senders": senders}


def get_timeline_stats(handler, parsed, _ctx) -> None:
    qs = parse_qs(parsed.query)
    timeline_name = qs.get("timeline", [""])[0].strip()
    if not timeline_name:
        handler._send_json(404, {"ok": False, "error": "Timeline not found"})
        return
    log_path = log_jsonl_path(timeline_name)
    if not log_path.is_file():
        handler._send_json(404, {"ok": False, "error": "Timeline not found"})
        return
    handler._send_json(200, {"ok": True, **_timeline_stats(log_path)})


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
    old_name = data.get("old_name", "").strip()
    new_name = data.get("new_name", "").strip()
    if any(not name or name in {".", ".."} or "/" in name or "\0" in name for name in (old_name, new_name)):
        handler._send_json(409, {"ok": False, "error": "Timeline name is not a valid folder name."})
        return
    source = agent_window_log_root() / old_name
    target = agent_window_log_root() / new_name
    if not source.is_dir():
        handler._send_json(409, {"ok": False, "error": "Timeline not found"})
        return
    if old_name != new_name and (target.exists() or target.is_symlink()):
        handler._send_json(409, {"ok": False, "error": "Timeline name already exists"})
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
        handler.log_error("Failed to rename timeline: %s", exc)
        handler._send_json(409, {"ok": False, "error": "Failed to rename timeline"})
        return
    ctx["hub"].publish_timeline_messages_changed()
    handler._send_json(200, {"ok": True, "old_name": old_name, "new_name": new_name})


def post_change_timeline_workspace(handler, _parsed, ctx) -> None:
    data = handler._read_form()
    timeline_name = data.get("timeline", "").strip()
    workspace = data.get("workspace", "").strip()
    live = live_timelines_query(ctx["hub"])
    if live.state == "unhealthy":
        handler._send_unhealthy("json", live.detail)
        return
    if timeline_name in live.workspaces:
        handler._send_json(409, {"ok": False, "error": "Archive first"})
        return
    try:
        current_workspace = log_workspace(timeline_name)
        hub = ctx["hub"]
        with hub._get_timeline_lock(current_workspace):
            hub.close_timeline(current_workspace)
            set_log_workspace(timeline_name, workspace)
    except LogMetaError as exc:
        handler.log_error("Failed to change workspace: %s", exc)
        handler._send_json(409, {"ok": False, "error": "Failed to change workspace"})
        return
    ctx["hub"].publish_timeline_messages_changed()
    handler._send_json(200, {"ok": True, "timeline": timeline_name, "workspace": workspace})


def post_reset_timeline_agents(handler, _parsed, ctx) -> None:
    data = handler._read_form()
    timeline_name = data.get("timeline", "").strip()
    try:
        reset_log_agents(timeline_name)
    except LogMetaError as exc:
        handler.log_error("Failed to reset agents: %s", exc)
        handler._send_json(409, {"ok": False, "error": "Failed to reset agents"})
        return
    ctx["hub"].publish_timeline_messages_changed()
    handler._send_json(200, {"ok": True, "timeline": timeline_name})
