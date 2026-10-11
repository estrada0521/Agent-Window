from __future__ import annotations

from server import http_proxy
from fs.log.meta import log_workspace_claims
from fs.log.paths import workspace_timeline_port

UPSTREAM_TIMEOUT = 30.0
STREAM_CHUNK_SIZE = 64 * 1024


def format_timeline_url(timeline_port: int, path: str) -> str:
    suffix = path if path.startswith("/") else f"/{path}"
    return f"/{int(timeline_port)}{suffix}"


def _read_body(handler, method: str) -> bytes | None:
    if method != "POST":
        return None
    length = int(handler.headers["Content-Length"])
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


def proxy_timeline(handler, method: str, parsed) -> bool:
    parts = parsed.path.split("/", 2)
    try:
        timeline_port = int(parts[1])
    except ValueError:
        return False
    if not 0 < timeline_port <= 65535:
        return False
    suffix = f"/{parts[2]}" if len(parts) == 3 else "/"
    if not any(workspace_timeline_port(workspace) == timeline_port for _name, workspace in log_workspace_claims().values()):
        _send_text(handler, 404, "404 Not Found")
        return True
    body = _read_body(handler, method)
    forwarded_prefix = format_timeline_url(timeline_port, "/").rstrip("/")
    headers = http_proxy.forward_headers(
        handler.headers,
        host=handler.headers.get("Host", "127.0.0.1"),
        forwarded_prefix=forwarded_prefix,
    )
    upstream_suffix = suffix + (f"?{parsed.query}" if parsed.query else "")
    upstream = f"http://127.0.0.1:{timeline_port}{upstream_suffix}"
    try:
        if method == "POST" and suffix == "/reload-timeline":
            response = http_proxy.read_upstream(
                method, upstream, body=body, headers=headers, timeout=UPSTREAM_TIMEOUT,
            )
            http_proxy.relay_buffered(handler, response)
            return True
        status, resp_headers, resp = http_proxy.open_upstream(
            method, upstream, body=body, headers=headers, timeout=UPSTREAM_TIMEOUT,
        )
    except http_proxy.TRANSIENT_UPSTREAM_ERRORS as exc:
        _send_text(handler, 502, f"502 Bad Gateway\n{exc}")
        return True
    http_proxy.relay_stream(handler, status, resp_headers, resp, chunk_size=STREAM_CHUNK_SIZE)
    return True
