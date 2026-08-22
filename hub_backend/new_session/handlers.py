from __future__ import annotations

import json
import shutil
import subprocess
import time
from pathlib import Path
from backend_core.access.session_meta import SessionMetaError, WorkspaceClaimConflict, find_session_for_workspace
from backend_core.access.settings import port_is_bindable, sanitize_session_name, workspace_chat_port
from backend_core.tmux.control import SessionControlError, create_session


def _workspace_claim_failure(workspace: str) -> tuple[int, str] | None:
    try:
        owner = find_session_for_workspace(workspace)
    except WorkspaceClaimConflict as exc:
        return 409, str(exc)
    except SessionMetaError as exc:
        return 500, str(exc)
    if owner:
        return 409, f"A session already exists for this workspace: {owner}"
    return None


def post_pick_workspace(handler, _parsed, _ctx) -> None:
    if not shutil.which("osascript"):
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
    # Checked before anything is created: write_session_metadata() has no
    # rollback, so finding out about a conflict only after it runs would
    # leave a stale .meta file behind with no session backing it.
    claim_failure = _workspace_claim_failure(resolved_workspace)
    if claim_failure:
        status, error = claim_failure
        handler._send_json(status, {"ok": False, "error": error})
        return
    session_name = sanitize_session_name(Path(resolved_workspace).name or "session") or "session"
    if ctx["session_api"].session_logs_dir(session_name).exists():
        handler._send_json(
            409,
            {
                "ok": False,
                "error": (
                    f"A session named '{session_name}' already exists. "
                    "Rename the workspace folder and try again."
                ),
            },
        )
        return
    # Checked before anything is created: workspace alone determines the
    # chat port, so a collision is knowable up front. Finding out only after
    # the tmux session already exists would leave a session running with no
    # way to reach it -- and nothing here would clean that session back up.
    chat_port = workspace_chat_port(resolved_workspace)
    if not port_is_bindable(chat_port):
        handler._send_json(409, {"ok": False, "error": f"chat port {chat_port} is occupied"})
        return
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
                tmux_socket=ctx["session_api"].ctx.hub.tmux_socket,
                repo_root=ctx["session_api"].ctx.hub.repo_root,
            )
        except SessionControlError as exc:
            handler._send_json(500, {"ok": False, "error": str(exc)})
            return
        ok, chat_port, detail = ctx["session_api"].ensure_active_chat_server(
            session_name,
            resolved_workspace,
        )
        if not ok:
            handler._send_json(500, {"ok": False, "error": detail})
            return
        record = ctx["session_api"].build_active_session_record(
            session_name,
            resolved_workspace,
            created_at=session_state["created_at"],
            updated_at=session_state["updated_at"],
        )
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    chat_url = ctx["format_session_chat_url_fn"](
        handler.headers.get("Host", "127.0.0.1"),
        session_name,
        int(chat_port),
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
