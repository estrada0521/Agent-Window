from __future__ import annotations

import time
from urllib.parse import urlparse

from backend_core.net import http_proxy
from hub_backend.chat_supervisor import ensure_chat_server
from hub_backend.server_helpers import format_chat_url
from hub_backend.session_api import split_chat_proxy_path, resolve_session_chat_target_by_port

SESSION_GET_RETRY_WINDOW = 3.0
SESSION_GET_RETRY_DELAY = 0.1
SESSION_POST_RETRY_WINDOW = 0.5
UPSTREAM_TIMEOUT = 30.0
STREAM_CHUNK_SIZE = 64 * 1024


def _read_body(handler, method: str) -> bytes | None:
    if method != "POST":
        return None
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        length = 0
    return handler.rfile.read(length)


def _send_text(handler, status: int, detail: str) -> None:
    body = detail.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    try:
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionResetError):
        return


def proxy_chat_session(handler, hub, method: str) -> None:
    parsed = urlparse(handler.path)
    split = split_chat_proxy_path(parsed.path)
    if split is None:
        handler.send_response(404)
        handler.end_headers()
        return
    chat_port, suffix = split
    resolved = resolve_session_chat_target_by_port(hub, chat_port)
    if resolved["status"] == "unhealthy":
        _send_text(handler, 503, str(resolved.get("detail") or "tmux unresponsive"))
        return
    if resolved["status"] != "ok":
        handler.send_response(404)
        handler.end_headers()
        return
    workspace = str(resolved.get("workspace") or "").strip()
    session_is_active = bool(resolved.get("session_is_active", True))
    body = _read_body(handler, method)
    forwarded_prefix = format_chat_url(chat_port, "/").rstrip("/")
    headers = http_proxy.forward_headers(
        handler.headers,
        host=handler.headers.get("Host", "127.0.0.1"),
        forwarded_prefix=forwarded_prefix,
    )
    get_deadline = time.time() + SESSION_GET_RETRY_WINDOW if method == "GET" else time.time()
    post_deadline = (
        time.time() + SESSION_POST_RETRY_WINDOW
        if method == "POST" and suffix == "/reload-chat"
        else time.time()
    )
    while True:
        ok, chat_port, detail = ensure_chat_server(
            hub,
            expected_active=session_is_active,
            workspace=workspace,
        )
        if not ok:
            _send_text(handler, 500, f"Failed to start chat on port {chat_port}: {detail}")
            return
        upstream_suffix = suffix + (f"?{parsed.query}" if parsed.query else "")
        upstream = f"http://127.0.0.1:{chat_port}{upstream_suffix}"
        last_exc = None
        response = None
        status = 0
        resp_headers = None
        resp = None
        try:
            if method == "POST" and suffix == "/reload-chat":
                response = http_proxy.read_upstream(
                    method, upstream, body=body, headers=headers, timeout=UPSTREAM_TIMEOUT,
                )
            else:
                status, resp_headers, resp = http_proxy.open_upstream(
                    method, upstream, body=body, headers=headers, timeout=UPSTREAM_TIMEOUT,
                )
        except http_proxy.TRANSIENT_UPSTREAM_ERRORS as exc:
            last_exc = exc
        if last_exc is not None:
            if method == "GET" and time.time() < get_deadline:
                time.sleep(SESSION_GET_RETRY_DELAY)
                continue
            if method == "POST" and suffix == "/reload-chat" and time.time() < post_deadline:
                time.sleep(SESSION_GET_RETRY_DELAY)
                continue
            _send_text(handler, 502, f"Bad Gateway: {last_exc}")
            return
        if method == "POST" and suffix == "/reload-chat":
            http_proxy.relay_buffered(handler, response)
            return
        if method == "GET" and status in {502, 503, 504} and time.time() < get_deadline:
            try:
                resp.close()
            except Exception:
                pass
            time.sleep(SESSION_GET_RETRY_DELAY)
            continue
        http_proxy.relay_stream(handler, status, resp_headers, resp, chunk_size=STREAM_CHUNK_SIZE)
        return
