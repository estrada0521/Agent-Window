from __future__ import annotations

import json
import os
import queue
import select
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from server.room.page import render_room_html
from server.room.state import RoomState
from server.room.room_process import launch_room_server, wait_for_room_server
from server.room.routes.assets import dispatch_get_assets_route
from server.room.routes.read import dispatch_get_read_route
from server.room.routes.write import dispatch_post_write_route
from server.room.assets import RoomAssets
from server.room.probe import read_room_server_state
from fs.log.paths import (
    workspace_room_port,
)
from fs.files.workspace import WorkspaceFiles
from fs.watch import start_workspace_fsevents_watcher
from git.commit import adopt_commit_baseline
from server.http_proxy import read_upstream


RELOAD_RUNNING_AGENTS_ENV = "AGENT_WINDOW_RELOAD_RUNNING_AGENTS"


def _not_initialized(*_args, **_kwargs):
    raise RuntimeError("room_server.initialize_from_argv() must run before serving requests")


_initialized = False
port = 0
workspace = ""
hub_port = 0
_repo_root = Path()
state = None
server_instance = ""
payload = _not_initialized
send_message = _not_initialized
files = None
assets = None
send_queue = None
send_queue_thread = None


def _log_watcher() -> None:
    while True:
        current_log_path = state.log_path
        fd = os.open(str(current_log_path), os.O_RDONLY)
        kq = select.kqueue()
        try:
            ev = select.kevent(
                fd,
                filter=select.KQ_FILTER_VNODE,
                flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR,
                fflags=select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND | select.KQ_NOTE_RENAME | select.KQ_NOTE_DELETE,
            )
            kq.control([ev], 0)
            while True:
                rebuilt = False
                events = kq.control(None, 4, None)
                for event in events:
                    if event.fflags & (select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND):
                        state.publish_event("messages")
                        try:
                            notify_hub_session_messages_changed(hub_port)
                        except (OSError, RuntimeError):
                            pass
                    if event.fflags & (select.KQ_NOTE_RENAME | select.KQ_NOTE_DELETE):
                        rebuilt = True
                        break
                if rebuilt:
                    break
        finally:
            kq.close()
            os.close(fd)


def _queued_send_worker() -> None:
    while True:
        job = send_queue.get()
        try:
            failed = state.deliver_message(job["targets"], job["message"])
            if failed:
                state.mark_agents_idle(failed)
                state.append_system_entry(
                    f"Send failed: Failed to deliver to: {', '.join(failed)}",
                )
        except Exception as exc:
            state.mark_agents_idle(job["targets"])
            state.append_system_entry(
                f"Send failed: {exc}",
            )
        finally:
            send_queue.task_done()


def _send_or_enqueue_message(
    target: str,
    message: str,
    client: str | None = None,
) -> tuple[int, dict]:
    normalized_message = str(message or "")
    if not normalized_message.strip():
        return 400, {"ok": False, "error": "message is required"}
    resolved_targets = [item.strip() for item in str(target or "").split(",") if item.strip()]
    if not resolved_targets:
        entry = state.append_user_entry(normalized_message, targets=["user"], client=client)
        return 200, {"ok": True, "mode": "note", "entry": entry}
    entry = state.append_user_entry(normalized_message, targets=resolved_targets, client=client)
    send_queue.put(
        {
            "target": ",".join(resolved_targets),
            "targets": resolved_targets,
            "message": normalized_message,
        }
    )
    return 200, {"ok": True, "entry": entry}


def _restart_env():
    env = os.environ.copy()
    env[RELOAD_RUNNING_AGENTS_ENV] = json.dumps(state.running_agents_for_reload())
    return env


def initialize_from_argv(argv: list[str] | None = None) -> None:
    global _initialized
    global port, workspace, hub_port
    global _repo_root, state
    global server_instance
    global payload
    global send_message, assets
    global send_queue, send_queue_thread, files

    if _initialized:
        return

    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        raise SystemExit("usage: python -m server.room.server <workspace>")

    workspace = str(argv[0] or "").strip()
    if not workspace:
        raise SystemExit("usage: python -m server.room.server <workspace>")

    _repo_root = Path(__file__).resolve().parents[2]
    port = workspace_room_port(workspace)
    hub_port = int((_repo_root / "hub-port").read_text().strip())
    reload_running_agents = json.loads(os.environ.pop(RELOAD_RUNNING_AGENTS_ENV, "[]"))
    state = RoomState(
        port=port,
        workspace=workspace,
        hub_port=hub_port,
        repo_root=_repo_root,
        initial_running_agents=reload_running_agents,
    )

    server_instance = state.server_instance
    payload = state.payload
    send_message = _send_or_enqueue_message
    files = WorkspaceFiles(
        workspace=workspace,
        repo_root=_repo_root,
    )
    start_workspace_fsevents_watcher(state, files)
    assets = RoomAssets(
        repo_root=_repo_root,
    )
    state.start_native_log_sync()
    try:
        adopt_commit_baseline(state)
    except Exception as exc:
        state.report_failure(f"commit tracking failed: {exc}")
    threading.Thread(
        target=_log_watcher,
        daemon=True,
        name="log-watch",
    ).start()
    send_queue = queue.Queue()
    send_queue_thread = threading.Thread(target=_queued_send_worker, daemon=True, name="send-queue")
    send_queue_thread.start()
    _initialized = True


room_restart_pending = False
room_restart_lock = threading.Lock()
room_restart_release_event = threading.Event()
server = None


def queue_room_restart():
    global room_restart_pending
    with room_restart_lock:
        if room_restart_pending:
            return False, "restart already pending", False
        room_restart_pending = True

    env = _restart_env()
    server.shutdown()
    server.server_close()
    try:
        process = launch_room_server(workspace, env=env)
    except OSError as exc:
        return False, str(exc), True
    expected_workspace = str(Path(workspace).expanduser().resolve())

    def _ready() -> bool:
        reported = read_room_server_state(port)
        reported_workspace = str((reported or {}).get("workspace") or "").strip()
        return bool(
            reported_workspace
            and str(Path(reported_workspace).expanduser().resolve()) == expected_workspace
        )

    detail = wait_for_room_server(process, _ready)
    return not detail, detail, True


def release_room_restart() -> None:
    room_restart_release_event.set()


def _route_context() -> dict:
    current_session_name, _current_log_path = state.session_binding_snapshot()
    return {
        "session_name": current_session_name,
        "server_instance": server_instance,
        "state": state,
        "workspace": workspace,
        "hub_port": hub_port,
        "room_port": port,
        "payload_fn": payload,
        "send_message_fn": send_message,
        "files": files,
        "assets": assets,
        "render_room_html_fn": render_room_html,
        "queue_room_restart_fn": queue_room_restart,
        "release_room_restart_fn": release_room_restart,
    }


class Handler(BaseHTTPRequestHandler):
    error_message_format = "%(code)d %(message)s\n"
    error_content_type = "text/plain; charset=utf-8"
    _GET_ROUTE_DISPATCHERS = (
        dispatch_get_assets_route,
        dispatch_get_read_route,
    )
    _POST_ROUTE_DISPATCHERS = (
        dispatch_post_write_route,
    )

    def log_message(self, format, *args):
        return

    def _send_json(self, status, body):
        payload_bytes = json.dumps(body, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload_bytes)))
        self.end_headers()
        self.wfile.write(payload_bytes)

    def _dispatch_routes(self, parsed, dispatchers, ctx) -> bool:
        for dispatch in dispatchers:
            if dispatch(self, parsed, ctx):
                return True
        return False

    def do_GET(self):
        parsed = urlparse(self.path)
        if self._dispatch_routes(parsed, self._GET_ROUTE_DISPATCHERS, _route_context()):
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if self._dispatch_routes(parsed, self._POST_ROUTE_DISPATCHERS, _route_context()):
            return
        self.send_response(404)
        self.end_headers()


def main(argv: list[str] | None = None) -> None:
    global server

    initialize_from_argv(argv)
    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer.request_queue_size = 128
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"http://127.0.0.1:{port}/", flush=True)
    server.serve_forever()
    if room_restart_pending:
        room_restart_release_event.wait()


HUB_NOTIFICATION_TIMEOUT_SEC = 1.0


def notify_hub_session_messages_changed(hub_port: int) -> None:
    response = read_upstream(
        "POST",
        f"http://127.0.0.1:{int(hub_port)}/session-messages-changed",
        body=b"",
        timeout=HUB_NOTIFICATION_TIMEOUT_SEC,
    )
    if response["status"] != 204:
        raise RuntimeError(f"Hub message notification returned HTTP {response['status']}")


if __name__ == "__main__":
    main()
