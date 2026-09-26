from __future__ import annotations

import json
import shlex
import subprocess
from pathlib import Path
from urllib.parse import unquote as url_unquote

from fs.log.paths import workspace_upload_dir
from tmux.control import add_agent, remove_agent
from tmux import TMUX, TMUX_SOCKET_NAME
from tmux.lifecycle import respawn_pane
from tmux.shortcut_command.execute import run_shortcut_command
from agents.executables import agent_launch_cmd
from git import repo as workspace_git

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


def _resolve_upload_path(path_value: str, *, workspace: str) -> Path:
    raw = str(path_value or "").strip()
    if not raw:
        raise ValueError("path required")
    upload_dir = workspace_upload_dir(workspace).resolve()
    given = Path(raw).expanduser()
    target = (
        given.resolve()
        if given.is_absolute()
        else (Path(workspace).expanduser().resolve() / given).resolve()
    )
    target.relative_to(upload_dir)
    return target


def _post_reload_room(handler, _parsed, ctx) -> None:
    owns_restart = False
    try:
        ok, detail, owns_restart = ctx["queue_room_restart_fn"]()
        handler._send_json(
            200 if ok else 503,
            {"ok": ok, "error": "" if ok else detail},
        )
        handler.wfile.flush()
    finally:
        if owns_restart:
            ctx["release_room_restart_fn"]()


def _post_add_agent(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    agent = (data.get("agent") or "").strip().lower()
    if not agent:
        handler._send_json(400, {"ok": False, "error": "agent required"})
        return
    state = ctx["state"]
    try:
        instance = add_agent(timeline_label=ctx["timeline_label"], agent=agent)
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    state.publish_event("state")
    handler._send_json(
        200,
        {"ok": True, "agent": instance, "message": f"Added agent {instance}", "targets": state.active_agents()},
    )


def _post_remove_agent(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    agent = (data.get("agent") or "").strip()
    if not agent:
        handler._send_json(400, {"ok": False, "error": "agent required"})
        return
    state = ctx["state"]
    try:
        instance = remove_agent(timeline_label=ctx["timeline_label"], agent=agent)
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    state.native_log.remove_binding(instance)
    state.publish_event("state")
    handler._send_json(
        200,
        {"ok": True, "agent": instance, "message": f"Removed agent {instance}", "targets": state.active_agents()},
    )


def _post_upload(handler, _parsed, ctx) -> None:
    content_type = handler.headers.get("Content-Type", "application/octet-stream")
    raw_name = handler.headers.get("X-Filename", "upload.bin") or "upload.bin"
    filename = url_unquote(raw_name)
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
    handler._send_json(200, {"ok": True, "path": str(save_path.relative_to(Path(ctx["workspace"])))})


def _post_delete_upload(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    path_rel = data.get("path", "")
    if not path_rel:
        handler._send_json(400, {"ok": False, "error": "path required"})
        return
    try:
        target = _resolve_upload_path(path_rel, workspace=ctx["workspace"])
    except ValueError as exc:
        handler._send_json(400, {"ok": False, "error": str(exc)})
        return
    try:
        target.unlink(missing_ok=True)
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    handler._send_json(200, {"ok": True})


def _switch_front_terminal_client(tmux_name: str) -> bool:
    terminal_tty = subprocess.run(
        ["osascript", "-e", 'tell application "Terminal" to get tty of selected tab of front window'],
        capture_output=True,
        text=True,
        check=False,
    )
    tty = (terminal_tty.stdout or "").strip()
    if terminal_tty.returncode != 0 or not tty:
        return False
    clients = subprocess.run(
        [*TMUX, "list-clients", "-F", "#{client_tty}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if clients.returncode != 0 or tty not in {(line or "").strip() for line in (clients.stdout or "").splitlines()}:
        return False
    switched = subprocess.run(
        [*TMUX, "switch-client", "-c", tty, "-t", tmux_name],
        capture_output=True,
        text=True,
        check=False,
    )
    return switched.returncode == 0


def _raise_terminal_window_for_tty(tty: str) -> bool:
    apple_script = (
        f'tell application "Terminal"\n'
        f"  set targetTTY to {json.dumps(tty)}\n"
        f"  repeat with w in windows\n"
        f"    if (tty of selected tab of w) is targetTTY then\n"
        f"      set index of w to 1\n"
        f"      activate\n"
        f"      return true\n"
        f"    end if\n"
        f"  end repeat\n"
        f"  return false\n"
        f"end tell"
    )
    result = subprocess.run(
        ["osascript", "-e", apple_script],
        capture_output=True, text=True, check=False,
    )
    return result.returncode == 0 and (result.stdout or "").strip() == "true"


def _open_terminal(handler, ctx, *, agent: str = "", pane_required: bool = False) -> None:
    def _ok() -> None:
        handler._send_json(200, {"ok": True})

    state = ctx["state"]
    if not state.room_is_active:
        handler._send_json(409, {"ok": False, "error": "tmux session is not active"})
        return
    tmux_name = state.tmux_session_name
    if agent:
        try:
            pane_id = state.pane_id_for_control_target(agent)
        except Exception as exc:
            handler._send_json(500, {"ok": False, "error": str(exc)})
            return
        if not pane_id and pane_required:
            handler._send_json(404, {"ok": False, "error": f"pane not found for {agent}"})
            return
        if pane_id:
            win_res = subprocess.run(
                [*TMUX, "display-message", "-p", "-t", pane_id, "#{window_id}"],
                capture_output=True, text=True, check=False,
            )
            window_id = (win_res.stdout or "").strip()
            if window_id:
                subprocess.run(
                    [*TMUX, "select-window", "-t", window_id],
                    capture_output=True, check=False,
                )
            subprocess.run(
                [*TMUX, "select-pane", "-t", pane_id],
                capture_output=True, check=False,
            )
            if _switch_front_terminal_client(tmux_name):
                subprocess.Popen(
                    ["osascript", "-e", 'tell application "Terminal" to activate'],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                _ok()
                return
            clients_res = subprocess.run(
                [*TMUX, "list-clients", "-t", tmux_name, "-F", "#{client_tty}"],
                capture_output=True, text=True, check=False,
            )
            if clients_res.returncode != 0:
                handler._send_json(500, {"ok": False, "error": "could not determine tmux session attachment"})
                return
            attached_ttys = [line.strip() for line in (clients_res.stdout or "").splitlines() if line.strip()]
            if attached_ttys:
                if not _raise_terminal_window_for_tty(attached_ttys[0]):
                    subprocess.Popen(
                        ["osascript", "-e", 'tell application "Terminal" to activate'],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                _ok()
                return
    try:
        cols, rows = 200, 40
        try:
            size_result = subprocess.run(
                [
                    *TMUX,
                    "display-message",
                    "-p",
                    "-t",
                    f"={tmux_name}:0",
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
            f"env -u TMUX -u TMUX_PANE tmux -L {TMUX_SOCKET_NAME} "
            f"attach-session -t {shlex.quote(tmux_name)}"
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
        subprocess.Popen(
            ["osascript", "-e", apple_script],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _ok()
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})


def _post_open_terminal(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    _open_terminal(handler, ctx, agent=str((data or {}).get("agent") or "").strip())


def _post_open_pane(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    raw_targets = [item.strip() for item in str(data.get("target") or "").split(",") if item.strip()]
    if not raw_targets:
        _open_terminal(
            handler, ctx, agent="terminal", pane_required=True,
        )
        return
    if len(raw_targets) != 1:
        handler._send_json(400, {"ok": False, "error": "select exactly one target"})
        return
    _open_terminal(
        handler, ctx, agent=raw_targets[0], pane_required=True,
    )


def _post_open_finder(handler, _parsed, ctx) -> None:
    workspace = ctx["workspace"]
    try:
        target = Path(workspace).resolve()
        if not target.exists():
            handler._send_json(404, {"ok": False, "error": "workspace not found"})
            return
        subprocess.Popen(
            ["open", str(target)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        handler._send_json(200, {"ok": True, "path": str(target)})
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})


def _post_open_shell(handler, _parsed, ctx) -> None:
    workspace = ctx["workspace"]
    try:
        target = Path(workspace).resolve()
        if not target.exists():
            handler._send_json(404, {"ok": False, "error": "workspace not found"})
            return
        apple_script = (
            f'tell application "Terminal"\n'
            f'  do script "cd " & quoted form of {json.dumps(str(target))}\n'
            f"  activate\n"
            f"end tell"
        )
        subprocess.Popen(
            ["osascript", "-e", apple_script],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
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
    result = ctx["files"].files_exist(paths)
    handler._send_json(200, result)


def _post_file_image_dimensions(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    paths = data.get("paths", [])
    if not isinstance(paths, list):
        handler._send_json(400, {"ok": False, "error": "paths must be a list"})
        return
    dimensions = ctx["files"].image_dimensions([str(path or "") for path in paths])
    handler._send_json(200, dimensions)


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
        resolved = ctx["files"].resolve_file_references([str(item or "") for item in queries])
    except Exception as exc:
        handler._send_json(500, {"ok": False, "error": str(exc)})
        return
    handler._send_json(200, {"ok": True, "resolved": resolved})


def _send_workspace_result(handler, call) -> None:
    try:
        result = call()
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


def _post_open_file(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    rel = (data.get("path") or "").strip()
    if not rel:
        handler._send_json(400, {"ok": False, "error": "path required"})
        return
    _send_workspace_result(handler, lambda: ctx["files"].open_with_default_app(rel))


def _post_reveal_file(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    rel = (data.get("path") or "").strip()
    if not rel:
        handler._send_json(400, {"ok": False, "error": "path required"})
        return
    _send_workspace_result(handler, lambda: ctx["files"].reveal_in_finder(rel))


def _post_reveal_log(handler, _parsed, ctx) -> None:
    _timeline, log_path = ctx["state"].timeline_binding_snapshot()
    _send_workspace_result(handler, lambda: ctx["files"].reveal_in_finder(str(log_path)))


def _post_quick_look(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    paths = data.get("paths", [])
    if not isinstance(paths, list) or not paths:
        handler._send_json(400, {"ok": False, "error": "paths required"})
        return
    _send_workspace_result(handler, lambda: ctx["files"].quick_look([str(p or "").strip() for p in paths]))


def _post_open_diff(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    rel = (data.get("path") or "").strip()
    if not rel:
        handler._send_json(400, {"ok": False, "error": "path required"})
        return
    _send_workspace_result(
        handler,
        lambda: workspace_git.open_diff_tool(
            ctx["workspace"],
            rel, (data.get("hash") or "").strip(), (data.get("old_path") or "").strip()
        ),
    )


def _run_nativelog_command(ctx, *, target: str) -> tuple[int, dict]:
    state = ctx["state"]
    files = ctx["files"]
    raw_targets = [t.strip() for t in target.split(",") if t.strip()]
    if not raw_targets:
        msg = "target is required"
        return 400, {"ok": False, "error": msg}
    agent = raw_targets[0]
    watched = state.native_log.watched_paths()
    path = (watched.get(agent) or "").strip()
    if not path:
        msg = f"native log path not found for {agent}"
        return 404, {"ok": False, "error": msg}
    try:
        files.reveal_in_finder(path)
    except FileNotFoundError:
        msg = f"native log file not found: {path}"
        return 404, {"ok": False, "error": msg}
    except Exception as exc:
        msg = str(exc)
        return 500, {"ok": False, "error": msg}
    return 200, {"ok": True}


def _post_native_log(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    status, body = _run_nativelog_command(ctx, target=str(data.get("target") or ""))
    handler._send_json(status, body)


def _post_shortcut_command(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    state = ctx["state"]
    command_id = str(data.get("command_id") or "").strip().lower()
    target = str(data.get("target") or "")
    if command_id == "idle":
        status, body = _run_idle_command(state, target)
    elif command_id == "restart":
        status, body = _run_restart_command(state, target)
    else:
        status, body = run_shortcut_command(
            agent_panes=state.agent_panes(),
            terminal_pane=state.pane_id_for_terminal(),
            command_id=command_id,
            arg=str(data.get("arg") or ""),
            target=target,
        )
    handler._send_json(status, body)


def _run_idle_command(state, target: str) -> tuple[int, dict]:
    agents = [item.strip() for item in target.split(",") if item.strip()]
    if not agents:
        return 400, {"ok": False, "error": "target is required"}
    state.mark_agents_idle(agents)
    return 200, {"ok": True}


def _run_restart_command(state, target: str) -> tuple[int, dict]:
    agents = [item.strip() for item in target.split(",") if item.strip()]
    if not agents:
        return 400, {"ok": False, "error": "target is required"}
    try:
        for agent in agents:
            pane_id = state.pane_id_for_agent(agent)
            if not pane_id:
                return 400, {"ok": False, "error": f"pane not found for {agent}"}
            ok, detail = respawn_pane(pane_id, workspace=state.workspace, command=agent_launch_cmd(agent), title=agent)
            if not ok:
                return 400, {"ok": False, "error": detail or f"failed to restart {agent}"}
            state.native_log.remove_binding(agent)
    except Exception as exc:
        return 500, {"ok": False, "error": str(exc)}
    state.append_system_entry(f"Restarted: {', '.join(agents)}", targets=agents)
    return 200, {"ok": True}


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


def _post_agent_running(handler, _parsed, ctx) -> None:
    data, err = _read_json_body(handler)
    if err:
        handler._send_json(400, {"ok": False, "error": err})
        return
    requested = data.get("targets")
    if not isinstance(requested, list):
        handler._send_json(400, {"ok": False, "error": "targets must be an array"})
        return
    active = set(ctx["state"].active_agents())
    targets = [str(item or "").strip() for item in requested]
    if not targets or any(not target or target not in active for target in targets):
        handler._send_json(400, {"ok": False, "error": "targets must name active agents"})
        return
    ctx["state"].mark_agents_running(list(dict.fromkeys(targets)))
    handler._send_json(200, {"ok": True})


_POST_ROUTES = {
    "/reload-room": _post_reload_room,
    "/add-agent": _post_add_agent,
    "/remove-agent": _post_remove_agent,
    "/upload": _post_upload,
    "/delete-upload": _post_delete_upload,
    "/open-terminal": _post_open_terminal,
    "/open-pane": _post_open_pane,
    "/open-finder": _post_open_finder,
    "/open-shell": _post_open_shell,
    "/files-exist": _post_files_exist,
    "/file-image-dimensions": _post_file_image_dimensions,
    "/files-resolve": _post_files_resolve,
    "/open-file": _post_open_file,
    "/reveal-file": _post_reveal_file,
    "/reveal-log": _post_reveal_log,
    "/quick-look": _post_quick_look,
    "/open-diff": _post_open_diff,
    "/shortcut-command": _post_shortcut_command,
    "/native-log": _post_native_log,
    "/agent-running": _post_agent_running,
    "/send": _post_send,
}


def dispatch_post_write_route(handler, parsed, ctx) -> bool:
    route = _POST_ROUTES.get(parsed.path)
    if route is None:
        return False
    route(handler, parsed, ctx)
    return True
