from __future__ import annotations

import http.client
import json
import time


ROOM_PROBE_TIMEOUT_SEC = 1.0


def read_room_server_state(room_port: int) -> dict | None:
    connection = None
    try:
        connection = http.client.HTTPConnection(
            "127.0.0.1",
            int(room_port),
            timeout=ROOM_PROBE_TIMEOUT_SEC,
        )
        connection.request(
            "GET",
            f"/room-state?ts={int(time.time() * 1000)}",
            headers={"Host": f"127.0.0.1:{int(room_port)}"},
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
