from __future__ import annotations

import http.client
import json
import ssl
import time

from .settings import pwa_https_enabled


CHAT_PROBE_TIMEOUT_SEC = 1.0


def read_chat_server_state(chat_port: int, *, scheme: str = "") -> dict | None:
    resolved_scheme = str(scheme or "").strip().lower()
    if not resolved_scheme:
        resolved_scheme = "https" if pwa_https_enabled() else "http"
    if resolved_scheme not in {"http", "https"}:
        raise ValueError(f"unsupported chat scheme: {resolved_scheme}")
    connection = None
    try:
        if resolved_scheme == "https":
            connection = http.client.HTTPSConnection(
                "127.0.0.1",
                int(chat_port),
                timeout=CHAT_PROBE_TIMEOUT_SEC,
                context=ssl._create_unverified_context(),
            )
        else:
            connection = http.client.HTTPConnection(
                "127.0.0.1",
                int(chat_port),
                timeout=CHAT_PROBE_TIMEOUT_SEC,
            )
        connection.request(
            "GET",
            f"/session-state?ts={int(time.time() * 1000)}",
            headers={"Host": f"127.0.0.1:{int(chat_port)}"},
        )
        response = connection.getresponse()
        body = response.read()
        if not 200 <= response.status < 300:
            return None
        decoded = json.loads(body.decode("utf-8", errors="replace"))
        return decoded if isinstance(decoded, dict) else None
    except (OSError, http.client.HTTPException, json.JSONDecodeError, TimeoutError):
        return None
    finally:
        if connection is not None:
            connection.close()
