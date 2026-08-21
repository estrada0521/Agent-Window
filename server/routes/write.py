from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
from pathlib import Path
from urllib.parse import unquote as url_unquote

from backend_core.access.settings import workspace_upload_dir
from backend_core.tmux.control import SessionControlError, add_agent, remove_agent
from backend_core.tmux.process_cleanup import track_fire_and_forget_pid
from backend_core.tmux.window import tmux_prefix_args
from shortcut_command.execute import run_shortcut_command

_MAX_UPLOAD_BYTES = 100 * 1024 * 1024


def _read_json_body(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        length = 0
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8") or "{}"), None
    except json.JSONDecodeError:
        return None, "invalid json"


def _resolve_within_root(path_value: str, *, workspace_root: str, allowed_root: Path) -> Path:
    raw = str(path_value or "").strip()
    if not raw:
        raise ValueError("path required")
    if raw.startswith("~"):
        candidate = Path(raw).expanduser().resolve()
    elif os.path.isabs(raw):
        candidate = Path(raw).resolve()
    else:
        candidate = (Path(workspace_root).resolve() / raw.lstrip("/")).resolve()
    root = allowed_root.resolve()
    candidate.relative_to(root)
    return candidate


def _post_new_chat(handler, _parsed, ctx) -> None:
    owns_restart = False
    try:
        ok, detail, owns_restart = ctx["queue_chat_restart_fn"]()
        handler._send_json(
            200 if ok else 503,
            {"ok": ok, "error": "" if ok else detail},
        )
        handler.wfile.flush()
    finally:
        if owns_restart:
            ctx["release_chat_restart_fn"]()


def _post_add_agent(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    agent = (data.get("agent") or "").strip().lower()
    if not agent:
        handler._send_json(400, {"ok": False, "error": "agent required"})
        return
    try:
        instance, rename = add_agent(
            session_name=ctx["session_name"],
            agent=agent,
            tmux_socket=str(getattr(ctx["runtime"], "tmux_socket", "") or ""),
            repo_root=ctx["repo_root"],
        )
    except SessionControlError as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return

    # The mutation above already succeeded (the agent exists in tmux now).
    # Nothing past this point should turn that success into a reported
    # failure - a client that saw a 500 here and retried would add a
    # second agent on top of the one that's already there. Each step below
    # is independent of the others, so each gets its own try/except: one
    # failing must not stop the rest from running.
    warnings: list[str] = []
    if rename:
        try:
            ctx["runtime"].rename_agent_identity(*rename)
        except Exception as exc:
            warnings.append(str(exc))
    try:
        targets = ctx["runtime"].active_agents()
    except Exception as exc:
        targets = []
        warnings.append(str(exc))
    with ctx["runtime"]._payload_cache_lock:
        ctx["runtime"]._payload_cache.clear()
        ctx["runtime"]._payload_cache_order.clear()
    try:
        ctx["runtime"]._native_log.on_pane_add(instance)
    except Exception as exc:
        warnings.append(str(exc))
    try:
        ctx["runtime"].refresh_native_log_bindings([instance], reason="add-agent")
    except Exception as exc:
        warnings.append(str(exc))
    try:
        ctx["runtime"].notify_session_state_changed(["targets", "statuses"], reason="targets-changed")
    except Exception as exc:
        warnings.append(str(exc))
    payload = {
        "ok": True,
        "agent": instance,
        "message": f"Added agent {instance}",
        "targets": targets,
    }
    if warnings:
        payload["warning"] = "; ".join(warnings)
    handler._send_json(200, payload)


def _post_remove_agent(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    agent = (data.get("agent") or "").strip()
    if not agent:
        handler._send_json(400, {"ok": False, "error": "agent required"})
        return
    try:
        instance, _scheduled = remove_agent(
            session_name=ctx["session_name"],
            agent=agent,
            tmux_socket=str(getattr(ctx["runtime"], "tmux_socket", "") or ""),
            repo_root=ctx["repo_root"],
        )
    except SessionControlError as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return

    # The mutation above already succeeded (the agent is gone from tmux
    # now). Nothing past this point should turn that success into a
    # reported failure. Each step below is independent of the others, so
    # each gets its own try/except: one failing must not stop the rest.
    warnings: list[str] = []
    try:
        targets = ctx["runtime"].active_agents()
    except Exception as exc:
        targets = []
        warnings.append(str(exc))
    with ctx["runtime"]._payload_cache_lock:
        ctx["runtime"]._payload_cache.clear()
        ctx["runtime"]._payload_cache_order.clear()
    try:
        ctx["runtime"].refresh_native_log_bindings(reason="remove-agent")
    except Exception as exc:
        warnings.append(str(exc))
    try:
        ctx["runtime"].notify_session_state_changed(["targets", "statuses"], reason="targets-changed")
    except Exception as exc:
        warnings.append(str(exc))
    payload = {
        "ok": True,
        "agent": instance,
        "message": f"Removed agent {instance}",
        "targets": targets,
    }
    if warnings:
        payload["warning"] = "; ".join(warnings)
    handler._send_json(200, payload)


def _post_upload(handler, _parsed, ctx) -> None:
    content_type = handler.headers.get("Content-Type", "application/octet-stream")
    raw_name = handler.headers.get("X-Filename", "upload.bin") or "upload.bin"
    try:
        filename = url_unquote(raw_name)
    except Exception:
        filename = raw_name
    filename = re.sub(r"[\x00-\x1f\x7f\u200b-\u200f\u2028\u2029]", "", str(filename)).strip()
    filename = Path(filename).name or "upload.bin"
    if filename in (".", ".."):
        filename = "upload.bin"
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        length = 0
    if length > _MAX_UPLOAD_BYTES:
        handler._send_json(413, {"ok": False, "error": f"upload exceeds {_MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit"})
        return
    data = handler.rfile.read(length)
    upload_dir = workspace_upload_dir(ctx["workspace"])
    upload_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(filename).stem or "upload"
    ext = Path(filename).suffix
    if not ext:
        mt = (content_type or "").split(";")[0].strip().lower()
        ext = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/gif": ".gif",
            "image/webp": ".webp",
        }.get(mt, ".bin")
    save_name = f"{stem}{ext}"
    save_path = upload_dir / save_name
    if save_path.exists():
        counter = 1
        while (upload_dir / f"{stem}_{counter}{ext}").exists():
            counter += 1
        save_name = f"{stem}_{counter}{ext}"
        save_path = upload_dir / save_name
    save_path.write_bytes(data)
    try:
        rel_path = str(save_path.relative_to(Path(ctx["workspace"])))
    except ValueError:
        rel_path = str(save_path)
    handler._send_json(200, {"ok": True, "path": rel_path})


def _post_delete_upload(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    path_rel = data.get("path", "")
    if not path_rel:
        handler._send_json(400, {"ok": False, "error": "path required"})
        return
    upload_dir = workspace_upload_dir(ctx["workspace"])
    try:
        target = _resolve_within_root(path_rel, workspace_root=ctx["workspace"], allowed_root=upload_dir)
    except ValueError as exc:
        handler._send_json(400, {"ok": False, "error": str(exc)})
        return
    try:
        target.unlink(missing_ok=True)
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    handler._send_json(200, {"ok": True})


def _post_open_terminal(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    agent = str((data or {}).get("agent") or "").strip()
    if agent:
        try:
            pane_id = ctx["runtime"].pane_id_for_agent(agent)
        except Exception as exc:
            handler._send_json(500, {"ok": False, "error": str(exc)})
            return
        if pane_id:
            prefix = tmux_prefix_args(ctx["tmux_socket"])
            win_res = subprocess.run(
                [*prefix, "display-message", "-p", "-t", pane_id, "#{window_id}"],
                capture_output=True, text=True, check=False,
            )
            window_id = (win_res.stdout or "").strip()
            if window_id:
                subprocess.run(
                    [*prefix, "select-window", "-t", window_id],
                    capture_output=True, check=False,
                )
            subprocess.run(
                [*prefix, "select-pane", "-t", pane_id],
                capture_output=True, check=False,
            )
            proc = subprocess.Popen(
                ["osascript", "-e", 'tell application "Terminal" to activate'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            track_fire_and_forget_pid(proc.pid)
            handler._send_json(200, {"ok": True})
            return
    try:
        prefix = tmux_prefix_args(ctx["tmux_socket"])
        socket_flag = prefix[1]
        cols, rows = 200, 40
        try:
            size_result = subprocess.run(
                [
                    *prefix,
                    "display-message",
                    "-p",
                    "-t",
                    f"={ctx['session_name']}:0",
                    "#{window_width} #{window_height}",
                ],
                capture_output=True,
                text=True,
                timeout=1.5,
                check=False,
            )
            if size_result.returncode == 0:
                parts = (size_result.stdout or "").strip().split()
                if len(parts) == 2:
                    parsed_cols = int(parts[0])
                    parsed_rows = int(parts[1])
                    if parsed_cols > 0 and parsed_rows > 0:
                        cols, rows = parsed_cols, parsed_rows
        except Exception:
            pass
        attach_cmd = (
            f"env -u TMUX -u TMUX_PANE tmux {socket_flag} "
            f"{shlex.quote(ctx['tmux_socket'])} attach-session -t {shlex.quote(ctx['session_name'])}"
        )
        apple_script = (
            f'tell application "Terminal"\n'
            f'  do script "{attach_cmd}"\n'
            f'  set targetWindow to front window\n'
            f'  set number of columns of targetWindow to {cols}\n'
            f'  set number of rows of targetWindow to {rows}\n'
            f'  activate\n'
            f'end tell'
        )
        proc = subprocess.Popen(
            ["osascript", "-e", apple_script],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        track_fire_and_forget_pid(proc.pid)
        handler._send_json(200, {"ok": True})
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})


def _post_open_finder(handler, _parsed, ctx) -> None:
    workspace = str(ctx["workspace"] or "").strip()
    if not workspace:
        handler._send_json(400, {"ok": False, "error": "workspace unavailable"})
        return
    try:
        target = Path(workspace).resolve()
        if not target.exists():
            handler._send_json(404, {"ok": False, "error": "workspace not found"})
            return
        proc = subprocess.Popen(
            ["open", str(target)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        track_fire_and_forget_pid(proc.pid)
        handler._send_json(200, {"ok": True, "path": str(target)})
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})


def _post_files_exist(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    paths = data.get("paths", [])
    if not isinstance(paths, list):
        handler._send_json(400, {"ok": False, "error": "paths must be a list"})
        return
    result = ctx["workspace_sync_api"].files_exist(paths)
    handler._send_json(200, result)


def _post_files_resolve(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    queries = data.get("queries", [])
    if not isinstance(queries, list):
        handler._send_json(400, {"ok": False, "error": "queries must be a list"})
        return
    try:
        resolved = ctx["workspace_sync_api"].resolve_file_references([str(item or "") for item in queries])
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    handler._send_json(200, {"ok": True, "resolved": resolved})


def _post_open_file(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    rel = (data.get("path") or "").strip()
    if not rel:
        handler._send_json(400, {"ok": False, "error": "path required"})
        return
    try:
        result = ctx["workspace_sync_api"].open_with_default_app(rel)
    except PermissionError:
        handler._send_json(403, {"ok": False, "error": "forbidden"})
        return
    except FileNotFoundError:
        handler._send_json(404, {"ok": False, "error": "file not found"})
        return
    except ValueError as exc:
        handler._send_json(400, {"ok": False, "error": str(exc)})
        return
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    handler._send_json(200, result)


def _post_open_diff(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    rel = (data.get("path") or "").strip()
    if not rel:
        handler._send_json(400, {"ok": False, "error": "path required"})
        return
    try:
        result = ctx["workspace_sync_api"].open_diff_tool(rel)
    except PermissionError:
        handler._send_json(403, {"ok": False, "error": "forbidden"})
        return
    except ValueError as exc:
        handler._send_json(400, {"ok": False, "error": str(exc)})
        return
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    handler._send_json(200, result)


def _run_nativelog_command(ctx, *, target: str) -> tuple[int, dict]:
    rt = ctx["runtime"]
    workspace_sync_api = ctx["workspace_sync_api"]
    raw_targets = [t.strip() for t in target.split(",") if t.strip()] if target.strip() else []
    resolved = [t for t in rt.resolve_target_agents(raw_targets[0]) if t] if raw_targets else []
    if not resolved:
        msg = "target is required"
        return 400, {"ok": False, "error": msg, "status_message": msg}
    agent = resolved[0]
    watched = rt.native_log_watched_paths()
    path = (watched.get(agent) or "").strip()
    if not path:
        msg = f"native log path not found for {agent}"
        return 404, {"ok": False, "error": msg, "status_message": msg}
    try:
        workspace_sync_api.reveal_in_finder(path)
    except FileNotFoundError:
        msg = f"native log file not found: {path}"
        return 404, {"ok": False, "error": msg, "status_message": msg}
    except Exception as exc:
        msg = str(exc)
        return 500, {"ok": False, "error": msg, "status_message": msg}
    return 200, {"ok": True, "status_message": f"revealed native log for {agent} in Finder"}


def _post_shortcut_command(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    command_id = str(data.get("command_id") or "")
    if command_id == "nativelog":
        status, body = _run_nativelog_command(
            ctx,
            target=str(data.get("target") or ""),
        )
        handler._send_json(status, body)
        return
    status, body = run_shortcut_command(
        ctx["runtime"],
        command_id=command_id,
        arg=str(data.get("arg") or ""),
        target=str(data.get("target") or ""),
    )
    handler._send_json(status, body)


def _post_send(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    status, body = ctx["send_message_fn"](
        data.get("target", ""),
        data.get("message", ""),
        data.get("client"),
    )
    handler._send_json(status, body)


_POST_ROUTES = {
    "/new-chat": _post_new_chat,
    "/add-agent": _post_add_agent,
    "/remove-agent": _post_remove_agent,
    "/upload": _post_upload,
    "/delete-upload": _post_delete_upload,
    "/open-terminal": _post_open_terminal,
    "/open-finder": _post_open_finder,
    "/files-exist": _post_files_exist,
    "/files-resolve": _post_files_resolve,
    "/open-file": _post_open_file,
    "/open-diff": _post_open_diff,
    "/shortcut-command": _post_shortcut_command,
    "/send": _post_send,
}


def dispatch_post_write_route(handler, parsed, ctx) -> bool:
    route = _POST_ROUTES.get(parsed.path)
    if route is None:
        return False
    route(handler, parsed, ctx)
    return True
