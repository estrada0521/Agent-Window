from __future__ import annotations

from urllib.parse import urlparse


def reject_cross_origin(handler) -> bool:
    origin = handler.headers.get("Origin")
    if origin is None or urlparse(origin).netloc == handler.headers.get("Host"):
        return False
    body = b"403 Forbidden"
    handler.send_response(403)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)
    return True
