from __future__ import annotations

from http.client import RemoteDisconnected
from urllib.error import HTTPError
from urllib.error import URLError
from urllib.request import Request, urlopen

TRANSIENT_UPSTREAM_ERRORS = (URLError, OSError, TimeoutError, RemoteDisconnected)

_SKIP_REQUEST_HEADERS = {"host", "content-length", "connection", "accept-encoding"}
_SKIP_RESPONSE_HEADERS = {"transfer-encoding", "connection", "content-length", "content-encoding"}


def forward_headers(
    source_headers,
    *,
    host: str,
    forwarded_prefix: str = "",
) -> dict[str, str]:
    headers: dict[str, str] = {}
    for key, value in source_headers.items():
        if key.lower() in _SKIP_REQUEST_HEADERS:
            continue
        headers[key] = value
    headers["Host"] = host
    headers["Accept-Encoding"] = "identity"
    if forwarded_prefix:
        headers["X-Forwarded-Prefix"] = forwarded_prefix
    return headers


def open_upstream(
    method: str,
    url: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float | None = 30.0,
):
    req = Request(url, data=body, method=method, headers=headers or {})
    try:
        resp = urlopen(req, timeout=timeout)
        return int(getattr(resp, "status", 200) or 200), resp.headers, resp
    except HTTPError as exc:
        return exc.code, exc.headers, exc


def read_upstream(
    method: str,
    url: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float | None = 30.0,
) -> dict:
    status, resp_headers, resp = open_upstream(method, url, body=body, headers=headers, timeout=timeout)
    try:
        resp_body = resp.read()
    finally:
        try:
            resp.close()
        except Exception:
            pass
    return {"status": status, "headers": resp_headers, "body": resp_body}


def _safe_write(handler, body: bytes) -> bool:
    try:
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionResetError):
        return False
    return True


def relay_buffered(handler, response: dict, *, extra_headers: dict[str, str] | None = None) -> None:
    status = int(response.get("status", 502))
    resp_headers = response.get("headers") or {}
    resp_body = response.get("body") or b""
    handler.send_response(status)
    for key, value in resp_headers.items():
        if key.lower() in _SKIP_RESPONSE_HEADERS:
            continue
        handler.send_header(key, value)
    for key, value in (extra_headers or {}).items():
        handler.send_header(key, value)
    handler.send_header("Content-Length", str(len(resp_body)))
    handler.end_headers()
    _safe_write(handler, resp_body)


def relay_stream(handler, status: int, resp_headers, resp, *, chunk_size: int = 64 * 1024) -> None:
    try:
        handler.send_response(status)
        for key, value in resp_headers.items():
            if key.lower() in {"transfer-encoding", "connection", "content-encoding"}:
                continue
            handler.send_header(key, value)
        handler.end_headers()
        read_chunk = getattr(resp, "read1", None) or resp.read
        while True:
            chunk = read_chunk(chunk_size)
            if not chunk:
                break
            if not _safe_write(handler, chunk):
                break
            try:
                handler.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                break
    finally:
        try:
            resp.close()
        except Exception:
            pass
