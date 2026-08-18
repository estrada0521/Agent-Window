from __future__ import annotations

import ssl
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
    extra: dict[str, str] | None = None,
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
    if extra:
        headers.update(extra)
    return headers


def open_upstream(
    method: str,
    url: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float | None = 30.0,
):
    """Issue the upstream request. Returns (status, response_headers, response).

    `response` is either the object returned by urlopen() or the HTTPError
    raised for a non-2xx status (both support .read()/.close()/.headers).
    The caller is responsible for closing it.
    """
    ctx = ssl._create_unverified_context() if url.startswith("https://") else None
    req = Request(url, data=body, method=method, headers=headers or {})
    try:
        resp = urlopen(req, context=ctx, timeout=timeout) if ctx is not None else urlopen(req, timeout=timeout)
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
    """Like open_upstream(), but buffers and returns the full response body."""
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
    """Send a read_upstream() result back to the client in one shot."""
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
    """Stream an open_upstream() response back to the client, then close it."""
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
