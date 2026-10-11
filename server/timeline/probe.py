from __future__ import annotations

import http.client
import json

from fs.log.paths import normalize_workspace


TIMELINE_PROBE_TIMEOUT_SEC = 1.0


def read_timeline_server_state(timeline_port: int) -> dict | None:
    connection = None
    try:
        connection = http.client.HTTPConnection(
            "127.0.0.1",
            int(timeline_port),
            timeout=TIMELINE_PROBE_TIMEOUT_SEC,
        )
        connection.request("GET", "/timeline-state")
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


def timeline_server_serves(state: dict | None, workspace: str) -> bool:
    return bool(state) and state.get("workspace") == normalize_workspace(workspace)
