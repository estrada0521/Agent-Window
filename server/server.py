from __future__ import annotations

import json
import logging
import os
import queue
import select
import ssl
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from hub_backend.presentation.chat.assets import (
    chat_app_script_asset,
    chat_main_style_asset,
    render_chat_html,
)
from server.runtime import ChatRuntime
from server.routes.assets import dispatch_get_assets_route
from server.routes.read import dispatch_get_read_route
from server.routes.write import dispatch_post_write_route
from server.asset_runtime import ChatAssetRuntime
from backend_core.access.files import append_jsonl_entry
from backend_core.access.settings import hub_settings_path
from workspace_sync.api import WorkspaceSyncApi

_PWA_STATIC_ROUTES = {
    "/pwa-icon-192.png": ("icon-192.png", "image/png", "public, max-age=3600"),
    "/pwa-icon-512.png": ("icon-512.png", "image/png", "public, max-age=3600"),
    "/apple-touch-icon.png": ("apple-touch-icon.png", "image/png", "public, max-age=3600"),
    "/service-worker.js": ("service-worker.js", "application/javascript; charset=utf-8", "no-store"),
}


def _not_initialized(*_args, **_kwargs):
    raise RuntimeError("chat_server.initialize_from_argv() must run before serving requests")


_initialized = False
index_path = Path()
limit = 0
session_name = ""
port = 0
agent_send_path = ""
workspace = ""
log_dir = ""
targets: list[str] = []
tmux_socket = ""
hub_port = 0
PUBLIC_HOST = ""
PUBLIC_HUB_PORT = 443
_repo_root = Path()
runtime = None
_PWA_STATIC_DIR = Path()
server_instance = ""
load_chat_settings = _not_initialized
chat_font_settings_inline_style = _not_initialized
payload = _not_initialized
append_system_entry = _not_initialized
send_message = _not_initialized
agent_statuses = _not_initialized
file_runtime = None
workspace_sync_api = None
asset_runtime = None
send_queue = None
send_queue_thread = None


def _build_outbound_user_entry(*, targets: list[str], message: str) -> dict:
    entry = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "session": session_name,
        "sender": "user",
        "targets": list(targets),
        "message": message,
        "msg_id": uuid.uuid4().hex[:12],
    }
    return entry


def _send_is_queueable(target: str, message: str) -> list[str] | None:
    if runtime is None or not runtime.session_is_active:
        return None
    normalized_target = str(target or "").strip()
    normalized_message = str(message or "").strip()
    if not normalized_target or not normalized_message:
        return None
    resolved_targets = runtime.resolve_target_agents(normalized_target)
    if not resolved_targets or resolved_targets == ["user"] or "user" in resolved_targets:
        return None
    return list(resolved_targets)


def _hub_settings_watcher() -> None:
    if sys.platform != "darwin":
        return
    settings_file = hub_settings_path(_repo_root)
    if not settings_file.exists():
        return
    try:
        kq = select.kqueue()
        fd = os.open(str(settings_file), os.O_RDONLY)
        ev = select.kevent(
            fd,
            filter=select.KQ_FILTER_VNODE,
            flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR,
            fflags=select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND,
        )
        kq.control([ev], 0)
    except OSError as exc:
        logging.error("hub settings watcher init failed: %s", exc)
        return
    while True:
        try:
            events = kq.control(None, 4, None)
            for event in events:
                if event.fflags & (select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND):
                    try:
                        if workspace_sync_api is not None:
                            workspace_sync_api.invalidate_hub_settings()
                            workspace_sync_api.publish_sync_event()
                    except Exception as exc:
                        logging.error("hub settings invalidation error: %s", exc)
        except Exception as exc:
            logging.error("hub settings watcher error: %s", exc)
            time.sleep(1.0)


def _message_index_watcher() -> None:
    if sys.platform != "darwin":
        return
    while True:
        fd = None
        try:
            index_path.parent.mkdir(parents=True, exist_ok=True)
            if not index_path.exists():
                index_path.touch()
            kq = select.kqueue()
            fd = os.open(str(index_path), os.O_RDONLY)
            ev = select.kevent(
                fd,
                filter=select.KQ_FILTER_VNODE,
                flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR,
                fflags=select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND | select.KQ_NOTE_RENAME | select.KQ_NOTE_DELETE,
            )
            kq.control([ev], 0)
            while True:
                events = kq.control(None, 4, None)
                for event in events:
                    if event.fflags & (select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND):
                        if runtime is not None:
                            runtime.notify_session_state_changed(["messages", "statuses"], reason="messages")
                    if event.fflags & (select.KQ_NOTE_RENAME | select.KQ_NOTE_DELETE):
                        raise OSError("message index path changed")
        except Exception as exc:
            logging.error("message index watcher error: %s", exc)
            time.sleep(1.0)
        finally:
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    pass


def _queued_send_worker() -> None:
    while True:
        job = send_queue.get()
        try:
            status, body = runtime.send_message(
                job.get("target", ""),
                job.get("message", ""),
                append_entry=False,
            )
            if status != 200 or not body.get("ok"):
                error = str(body.get("error") or "send failed").strip() or "send failed"
                runtime.append_system_entry(
                    f"Send failed: {error}",
                    kind="send-error",
                    related_msg_id=job.get("msg_id", ""),
                    failed_targets=list(job.get("targets") or []),
                )
        except Exception as exc:
            runtime.append_system_entry(
                f"Send failed: {exc}",
                kind="send-error",
                related_msg_id=job.get("msg_id", ""),
                failed_targets=list(job.get("targets") or []),
            )
        finally:
            send_queue.task_done()


def _send_or_enqueue_message(
    target: str,
    message: str,
) -> tuple[int, dict]:
    queue_targets = _send_is_queueable(target, message)
    if not queue_targets:
        return runtime.send_message(
            target,
            message,
        )
    entry = _build_outbound_user_entry(targets=queue_targets, message=message)
    append_jsonl_entry(runtime.index_path, entry)
    send_queue.put(
        {
            "target": ",".join(queue_targets),
            "targets": queue_targets,
            "message": str(message or "").strip(),
            "msg_id": entry["msg_id"],
        }
    )
    return 200, {
        "ok": True,
        "queued": True,
        "msg_id": entry["msg_id"],
        "targets": queue_targets,
        "entry": entry,
    }


def _clean_env():
    env = os.environ.copy()
    env["AGENT_WINDOW_AGENT_NAME"] = "user"
    return env


def initialize_from_argv(argv: list[str] | None = None) -> None:
    global _initialized
    global index_path, limit, session_name
    global port, agent_send_path, workspace, log_dir, targets, tmux_socket, hub_port
    global PUBLIC_HOST, PUBLIC_HUB_PORT, _repo_root, runtime
    global _PWA_STATIC_DIR, server_instance, load_chat_settings, chat_font_settings_inline_style
    global payload, append_system_entry
    global send_message, agent_statuses, file_runtime, asset_runtime
    global send_queue, send_queue_thread, workspace_sync_api

    if _initialized:
        return

    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 10:
        raise SystemExit(
            "usage: python -m server.server "
            "<index_path> <limit> <session_name> "
            "<port> <agent_send_path> <workspace> <log_dir> <targets_csv> <tmux_socket> <hub_port>"
        )

    index_path = Path(argv[0])
    limit = int(argv[1])
    session_name = argv[2]
    port = int(argv[3])
    agent_send_path = argv[4]
    workspace = argv[5]
    log_dir = argv[6]
    targets = [item for item in argv[7].split(",") if item]
    tmux_socket = argv[8]
    hub_port = int(argv[9])
    PUBLIC_HOST = (os.environ.get("AGENT_WINDOW_PUBLIC_HOST", "") or "").strip().rstrip(".").lower()
    PUBLIC_HUB_PORT = int(os.environ.get("AGENT_WINDOW_PUBLIC_HUB_PORT", "443") or "443")

    _repo_root = Path(agent_send_path).parent.parent
    runtime = ChatRuntime(
        index_path=index_path,
        limit=limit,
        session_name=session_name,
        port=port,
        agent_send_path=agent_send_path,
        workspace=workspace,
        log_dir=log_dir,
        targets=targets,
        tmux_socket=tmux_socket,
        hub_port=hub_port,
        repo_root=_repo_root,
        session_is_active=(os.environ.get("SESSION_IS_ACTIVE", "0") == "1"),
    )

    _PWA_STATIC_DIR = _repo_root / "apps" / "shared" / "pwa"
    server_instance = runtime.server_instance
    load_chat_settings = runtime.load_chat_settings
    chat_font_settings_inline_style = runtime.chat_font_settings_inline_style
    payload = runtime.payload
    append_system_entry = runtime.append_system_entry
    send_message = _send_or_enqueue_message
    agent_statuses = runtime.agent_statuses
    workspace_sync_api = WorkspaceSyncApi(
        workspace=workspace,
        allowed_roots=[index_path.parent],
        repo_root=_repo_root,
        index_path=index_path,
        runtime=runtime,
    )
    file_runtime = workspace_sync_api.file_runtime
    asset_runtime = ChatAssetRuntime(
        repo_root=_repo_root,
    )
    runtime.start_native_log_sync()
    try:
        runtime.ensure_commit_announcements()
    except Exception as exc:
        logging.error("commit announcement startup refresh failed: %s", exc)
    threading.Thread(
        target=_hub_settings_watcher,
        daemon=True,
        name="hub-settings-watch",
    ).start()
    threading.Thread(
        target=_message_index_watcher,
        daemon=True,
        name="message-index-watch",
    ).start()
    send_queue = queue.Queue()
    send_queue_thread = threading.Thread(target=_queued_send_worker, daemon=True, name="send-queue")
    send_queue_thread.start()
    _initialized = True


def _pwa_asset_url(path: str, base_path: str = "") -> str:
    prefix = (base_path or "").rstrip("/")
    return f"{prefix}{path}" if prefix else path


def _pwa_icon_entries(base_path: str = "") -> list[dict[str, str]]:
    return [
        {
            "src": _pwa_asset_url("/pwa-icon-192.png", base_path),
            "sizes": "192x192",
            "type": "image/png",
            "purpose": "any",
        },
        {
            "src": _pwa_asset_url("/pwa-icon-512.png", base_path),
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "any",
        },
    ]


def _serve_pwa_static(handler, path: str) -> bool:
    spec = _PWA_STATIC_ROUTES.get(path)
    if spec is None:
        return False
    filename, content_type, cache_control = spec
    try:
        body = (_PWA_STATIC_DIR / filename).read_bytes()
    except Exception:
        handler.send_response(404)
        handler.end_headers()
        return True
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Cache-Control", cache_control)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)
    return True


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

    bin_dir = Path(agent_send_path).resolve().parent.parent / "bin"
    script_path = str(bin_dir / "agent-index")
    done = threading.Event()
    result = {"ok": False}

    def worker():
        try:
            if server is not None:
                server.shutdown()
                server.server_close()
            env = _clean_env()
            env["AGENT_WINDOW_AGENT_NAME"] = "user"
            env["AGENT_WINDOW_CHAT_RESTART_HANDOFF"] = "1"
            completed = subprocess.run(
                [script_path, "--chat", "--session", session_name],
                cwd=str(_repo_root),
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            result["ok"] = completed.returncode == 0
        finally:
            done.set()

    threading.Thread(target=worker, daemon=True, name="chat-restart").start()
    done.wait()
    return result["ok"], "" if result["ok"] else "reload failed", True


def release_chat_restart() -> None:
    chat_restart_release_event.set()


def _route_context() -> dict:
    return {
        "session_name": session_name,
        "server_instance": server_instance,
        "runtime": runtime,
        "workspace": workspace,
        "session_dir": str(index_path.parent),
        "log_dir": log_dir,
        "port": port,
        "hub_port": hub_port,
        "tmux_socket": tmux_socket,
        "agent_send_path": agent_send_path,
        "repo_root": _repo_root,
        "public_host": PUBLIC_HOST,
        "public_hub_port": PUBLIC_HUB_PORT,
        "payload_fn": payload,
        "append_system_entry_fn": append_system_entry,
        "send_message_fn": send_message,
        "agent_statuses_fn": agent_statuses,
        "file_runtime": file_runtime,
        "workspace_sync_api": workspace_sync_api,
        "asset_runtime": asset_runtime,
        "load_chat_settings_fn": load_chat_settings,
        "chat_font_settings_inline_style_fn": chat_font_settings_inline_style,
        "pwa_asset_url_fn": _pwa_asset_url,
        "pwa_icon_entries_fn": _pwa_icon_entries,
        "serve_pwa_static_fn": _serve_pwa_static,
        "chat_app_script_asset_fn": chat_app_script_asset,
        "chat_main_style_asset_fn": chat_main_style_asset,
        "render_chat_html_fn": render_chat_html,
        "clean_env_fn": _clean_env,
        "queue_chat_restart_fn": queue_chat_restart,
        "release_chat_restart_fn": release_chat_restart,
    }


class Handler(BaseHTTPRequestHandler):
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


def _kill_stale_sync_processes(index_path_str: str) -> None:
    import signal

    my_pid = os.getpid()
    try:
        result = subprocess.run(
            ["pgrep", "-f", f"server.server.*{index_path_str}"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        for line in result.stdout.strip().splitlines():
            pid_str = line.strip()
            if not pid_str:
                continue
            try:
                pid = int(pid_str)
            except ValueError:
                continue
            if pid == my_pid:
                continue
            try:
                os.kill(pid, signal.SIGTERM)
                logging.info("Killed stale chat_server PID %d for %s", pid, index_path_str)
            except OSError:
                pass
    except Exception as exc:
        logging.debug("_kill_stale_sync_processes: %s", exc)


def main(argv: list[str] | None = None) -> None:
    global server

    initialize_from_argv(argv)
    if os.environ.get("AGENT_WINDOW_CHAT_RESTART_HANDOFF") != "1":
        _kill_stale_sync_processes(str(index_path))

    cert_file = os.environ.get("AGENT_WINDOW_CERT_FILE", "")
    key_file = os.environ.get("AGENT_WINDOW_KEY_FILE", "")
    use_https = bool(cert_file and key_file)
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    scheme = "http"
    if use_https:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert_file, key_file)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
        scheme = "https"
    print(f"{scheme}://127.0.0.1:{port}/", flush=True)
    server.serve_forever()
    if chat_restart_pending:
        chat_restart_release_event.wait()


if __name__ == "__main__":
    main()
