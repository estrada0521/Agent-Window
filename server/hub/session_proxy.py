from __future__ import annotations

from urllib.parse import urlparse

from server import http_proxy
from server.hub.server_helpers import format_room_url
from fs.session.meta import session_workspace_claims
from fs.session.paths import workspace_room_port
from server.hub.session_api import split_room_proxy_path

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


def proxy_room_session(handler, method: str) -> None:
    parsed = urlparse(handler.path)
    room_port, suffix = split_room_proxy_path(parsed.path)
    if not any(workspace_room_port(workspace) == room_port for _name, workspace in session_workspace_claims().values()):
        _send_text(handler, 404, "404 Not Found")
        return
    body = _read_body(handler, method)
    forwarded_prefix = format_room_url(room_port, "/").rstrip("/")
    headers = http_proxy.forward_headers(
        handler.headers,
        host=handler.headers.get("Host", "127.0.0.1"),
        forwarded_prefix=forwarded_prefix,
    )
    upstream_suffix = suffix + (f"?{parsed.query}" if parsed.query else "")
    upstream = f"http://127.0.0.1:{room_port}{upstream_suffix}"
    try:
        if method == "POST" and suffix == "/reload-room":
            response = http_proxy.read_upstream(
                method, upstream, body=body, headers=headers, timeout=UPSTREAM_TIMEOUT,
            )
            http_proxy.relay_buffered(handler, response)
            return
        status, resp_headers, resp = http_proxy.open_upstream(
            method, upstream, body=body, headers=headers, timeout=UPSTREAM_TIMEOUT,
        )
    except http_proxy.TRANSIENT_UPSTREAM_ERRORS as exc:
        _send_text(handler, 502, f"502 Bad Gateway\n{exc}")
        return
    http_proxy.relay_stream(handler, status, resp_headers, resp, chunk_size=STREAM_CHUNK_SIZE)
