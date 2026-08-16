from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs

from backend_core.tmux.control import SessionControlError, create_session


def get_check_session_name(handler, parsed, ctx) -> None:
    qs = parse_qs(parsed.query)
    workspace = (qs.get("workspace", [""])[0] or "").strip()
    if not workspace:
        handler._send_json(400, {"ok": False, "error": "workspace required"})
        return
    try:
        resolved = str(Path(workspace).expanduser().resolve())
    except Exception as exc:
        handler._send_json(400, {"ok": False, "error": str(exc)})
        return
    original = re.sub(r"[^a-zA-Z0-9_.\-]", "-", Path(resolved).name or "session").strip(".-")[:64] or "session"
    proposed = ctx["session_api"].unique_session_name_for_workspace(resolved)
    handler._send_json(200, {"ok": True, "name": proposed, "original": original, "conflict": proposed != original})


def post_pick_workspace(handler, _parsed, _ctx) -> None:
    if sys.platform != "darwin" or not shutil.which("osascript"):
        handler._send_json(501, {"ok": False, "error": "native workspace picker is unavailable on this device"})
        return
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        length = 0
    raw = handler.rfile.read(length)
    try:
        data = json.loads(raw.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        handler._send_json(400, {"ok": False, "error": "invalid json"})
        return
    if not isinstance(data, dict):
        handler._send_json(400, {"ok": False, "error": "invalid json"})
        return
    start_path = str(data.get("path") or "").strip()
    start_clause = ""
    if start_path:
        candidate = Path(start_path).expanduser().resolve()
        if not candidate.exists():
            handler._send_json(400, {"ok": False, "error": f"path not found: {candidate}"})
            return
        escaped = str(candidate).replace("\\", "\\\\").replace('"', '\\"')
        start_clause = f' default location POSIX file "{escaped}"'
    script = (
        'set chosenFolder to choose folder with prompt "Choose workspace folder"'
        f"{start_clause}\n"
        "return POSIX path of chosenFolder"
    )
    try:
        proc = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=180,
        )
    except subprocess.TimeoutExpired:
        handler._send_json(504, {"ok": False, "error": "workspace picker timed out"})
        return
    stderr_text = str(proc.stderr or "").strip()
    if proc.returncode != 0:
        if "-128" in stderr_text or "User canceled" in stderr_text:
            handler._send_json(200, {"ok": False, "canceled": True})
            return
        handler._send_json(500, {"ok": False, "error": stderr_text or "workspace picker failed"})
        return
    chosen = str(proc.stdout or "").strip()
    if not chosen:
        handler._send_json(500, {"ok": False, "error": "workspace picker returned an empty path"})
        return
    try:
        resolved = Path(chosen).expanduser().resolve()
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    if not resolved.is_dir():
        handler._send_json(400, {"ok": False, "error": f"Invalid workspace: {resolved}"})
        return
    handler._send_json(200, {"ok": True, "path": str(resolved)})


def post_start_session_draft(handler, _parsed, ctx) -> None:
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        length = 0
    raw = handler.rfile.read(length)
    try:
        data = json.loads(raw.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        handler._send_json(400, {"ok": False, "error": "invalid json"})
        return
    workspace = str(data.get("workspace") or "").strip()
    if not workspace:
        handler._send_json(400, {"ok": False, "error": "workspace required"})
        return
    try:
        resolved_workspace = str(Path(workspace).expanduser().resolve())
    except Exception as exc:
        handler._send_json(400, {"ok": False, "error": str(exc)})
        return
    if not Path(resolved_workspace).is_dir():
        handler._send_json(400, {"ok": False, "error": f"Invalid workspace: {resolved_workspace}"})
        return
    override_name = re.sub(r"[^a-zA-Z0-9_.\-]", "-", str(data.get("session_name") or "")).strip(".-")[:64]
    if override_name:
        query = ctx["active_session_records_query_fn"]()
        existing = set(query.records.keys())
        existing.update(ctx["archived_session_records_fn"](existing).keys())
        if override_name in existing or ctx["session_api"].session_logs_dir(override_name).exists():
            handler._send_json(409, {"ok": False, "error": f"セッション名 '{override_name}' は既に使用されています"})
            return
        session_name = override_name
    else:
        session_name = ctx["session_api"].unique_session_name_for_workspace(resolved_workspace)
    try:
        # Write session metadata files before launching the empty tmux session.
        session_state = ctx["session_api"].write_session_metadata(
            session_name,
            resolved_workspace,
        )
        try:
            create_session(
                session_name=session_name,
                workspace=resolved_workspace,
                agents=[],
                tmux_socket=str(getattr(ctx["session_api"].ctx.hub, "tmux_socket", "") or ""),
                repo_root=ctx["session_api"].ctx.repo_root,
            )
        except SessionControlError as exc:
            handler._send_json(500, {"ok": False, "error": str(exc)})
            return
        # Start chat server with SESSION_IS_ACTIVE=1 (session is live immediately)
        ok, chat_port, detail = ctx["session_api"].ensure_active_chat_server(
            session_name,
            resolved_workspace,
        )
        if not ok:
            handler._send_json(500, {"ok": False, "error": detail})
            return
        # Get session record from active sessions query
        query = ctx["active_session_records_query_fn"]()
        record = query.records.get(session_name) or ctx["session_api"].build_active_session_record(
            session_name,
            resolved_workspace,
            created_at=session_state.get("created_at", ""),
            updated_at=session_state.get("updated_at", ""),
        )
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    chat_url = ctx["format_session_chat_url_fn"](
        handler.headers.get("Host", "127.0.0.1"),
        session_name,
        int(chat_port or 0),
        f"/?ts={int(time.time() * 1000)}",
    )
    handler._send_json(
        200,
        {
            "ok": True,
            "session": session_name,
            "chat_url": chat_url,
            "session_record": record,
        },
    )
