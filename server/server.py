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

from hub_backend.presentation.chat.assets import render_chat_html
from server.runtime import ChatRuntime
from server.chat_process import launch_chat_server, wait_for_chat_server
from server.hub_session_events import notify_hub_session_messages_changed
from server.routes.assets import dispatch_get_assets_route
from server.routes.read import dispatch_get_read_route
from server.routes.write import dispatch_post_write_route
from server.asset_runtime import ChatAssetRuntime
from backend_core.access.chat_server import read_chat_server_state
from backend_core.access.settings import (
    workspace_chat_port,
)
from workspace_sync import git as workspace_git
from workspace_sync.files.runtime import FileRuntime
from workspace_sync.watch import start_workspace_fsevents_watcher
from workspace_sync.commit import adopt_commit_baseline

RELOAD_RUNNING_AGENTS_ENV = "AGENT_WINDOW_RELOAD_RUNNING_AGENTS"


def _not_initialized(*_args, **_kwargs):
    raise RuntimeError("chat_server.initialize_from_argv() must run before serving requests")


_initialized = False
port = 0
workspace = ""
hub_port = 0
_repo_root = Path()
runtime = None
server_instance = ""
payload = _not_initialized
send_message = _not_initialized
file_runtime = None
asset_runtime = None
send_queue = None
send_queue_thread = None


def _log_watcher() -> None:
    while True:
        current_log_path = runtime.log_path
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
                        runtime.publish_event("messages")
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
            failed = runtime.deliver_message(job["targets"], job["message"])
            if failed:
                runtime.mark_agents_idle(failed)
                runtime.append_system_entry(
                    f"Send failed: Failed to deliver to: {', '.join(failed)}",
                )
        except Exception as exc:
            runtime.mark_agents_idle(job["targets"])
            runtime.append_system_entry(
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
        entry = runtime.append_user_entry(normalized_message, targets=["user"], client=client)
        return 200, {"ok": True, "mode": "note", "entry": entry}
    entry = runtime.append_user_entry(normalized_message, targets=resolved_targets, client=client)
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
    env[RELOAD_RUNNING_AGENTS_ENV] = json.dumps(runtime.running_agents_for_reload())
    return env


def initialize_from_argv(argv: list[str] | None = None) -> None:
    global _initialized
    global port, workspace, hub_port
    global _repo_root, runtime
    global server_instance
    global payload
    global send_message, asset_runtime
    global send_queue, send_queue_thread, file_runtime

    if _initialized:
        return

    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        raise SystemExit("usage: python -m server.server <workspace>")

    workspace = str(argv[0] or "").strip()
    if not workspace:
        raise SystemExit("usage: python -m server.server <workspace>")

    _repo_root = Path(__file__).resolve().parent.parent
    port = workspace_chat_port(workspace)
    hub_port = int((_repo_root / "hub-port").read_text().strip())
    reload_running_agents = json.loads(os.environ.pop(RELOAD_RUNNING_AGENTS_ENV, "[]"))
    runtime = ChatRuntime(
        port=port,
        workspace=workspace,
        hub_port=hub_port,
        repo_root=_repo_root,
        initial_running_agents=reload_running_agents,
    )

    server_instance = runtime.server_instance
    payload = runtime.payload
    send_message = _send_or_enqueue_message
    file_runtime = FileRuntime(
        workspace=workspace,
        repo_root=_repo_root,
    )
    workspace_git.configure(workspace=workspace)
    start_workspace_fsevents_watcher(runtime, file_runtime)
    asset_runtime = ChatAssetRuntime(
        repo_root=_repo_root,
    )
    runtime.start_native_log_sync()
    try:
        adopt_commit_baseline(runtime)
    except Exception as exc:
        runtime.report_failure(f"commit tracking failed: {exc}")
    threading.Thread(
        target=_log_watcher,
        daemon=True,
        name="log-watch",
    ).start()
    send_queue = queue.Queue()
    send_queue_thread = threading.Thread(target=_queued_send_worker, daemon=True, name="send-queue")
    send_queue_thread.start()
    _initialized = True


chat_restart_pending = False
chat_restart_lock = threading.Lock()
chat_restart_release_event = threading.Event()
server = None


def queue_chat_restart():
    global chat_restart_pending
    with chat_restart_lock:
        if chat_restart_pending:
            return False, "restart already pending", False
        chat_restart_pending = True

    env = _restart_env()
    server.shutdown()
    server.server_close()
    try:
        process = launch_chat_server(workspace, env=env)
    except OSError as exc:
        return False, str(exc), True
    expected_workspace = str(Path(workspace).expanduser().resolve())

    def _ready() -> bool:
        state = read_chat_server_state(port)
        reported_workspace = str((state or {}).get("workspace") or "").strip()
        return bool(
            reported_workspace
            and str(Path(reported_workspace).expanduser().resolve()) == expected_workspace
        )

    detail = wait_for_chat_server(process, _ready)
    return not detail, detail, True


def release_chat_restart() -> None:
    chat_restart_release_event.set()


def _route_context() -> dict:
    current_session_name, _current_log_path = runtime.session_binding_snapshot()
    return {
        "session_name": current_session_name,
        "server_instance": server_instance,
        "runtime": runtime,
        "workspace": workspace,
        "hub_port": hub_port,
        "payload_fn": payload,
        "send_message_fn": send_message,
        "file_runtime": file_runtime,
        "asset_runtime": asset_runtime,
        "render_chat_html_fn": render_chat_html,
        "queue_chat_restart_fn": queue_chat_restart,
        "release_chat_restart_fn": release_chat_restart,
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
    if chat_restart_pending:
        chat_restart_release_event.wait()


if __name__ == "__main__":
    main()
