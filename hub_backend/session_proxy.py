from __future__ import annotations

from urllib.parse import urlparse

from backend_core.net import http_proxy
from hub_backend.server_helpers import format_chat_url
from backend_core.access.session_meta import session_workspace_claims
from backend_core.access.settings import workspace_chat_port
from hub_backend.session_api import split_chat_proxy_path

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


def proxy_chat_session(handler, method: str) -> None:
    parsed = urlparse(handler.path)
    chat_port, suffix = split_chat_proxy_path(parsed.path)
    if not any(workspace_chat_port(workspace) == chat_port for _name, workspace in session_workspace_claims().values()):
        handler.send_response(404)
        handler.end_headers()
        return
    body = _read_body(handler, method)
    forwarded_prefix = format_chat_url(chat_port, "/").rstrip("/")
    headers = http_proxy.forward_headers(
        handler.headers,
        host=handler.headers.get("Host", "127.0.0.1"),
        forwarded_prefix=forwarded_prefix,
    )
    upstream_suffix = suffix + (f"?{parsed.query}" if parsed.query else "")
    upstream = f"http://127.0.0.1:{chat_port}{upstream_suffix}"
    try:
        if method == "POST" and suffix == "/reload-chat":
            response = http_proxy.read_upstream(
                method, upstream, body=body, headers=headers, timeout=UPSTREAM_TIMEOUT,
            )
            http_proxy.relay_buffered(handler, response)
            return
        status, resp_headers, resp = http_proxy.open_upstream(
            method, upstream, body=body, headers=headers, timeout=UPSTREAM_TIMEOUT,
        )
    except http_proxy.TRANSIENT_UPSTREAM_ERRORS as exc:
        _send_text(handler, 502, f"Bad Gateway: {exc}")
        return
    http_proxy.relay_stream(handler, status, resp_headers, resp, chunk_size=STREAM_CHUNK_SIZE)
