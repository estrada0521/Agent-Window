from __future__ import annotations

from server.http_proxy import read_upstream


HUB_NOTIFICATION_TIMEOUT_SEC = 1.0


def notify_hub_session_messages_changed(hub_port: int) -> None:
    response = read_upstream(
        "POST",
        f"http://127.0.0.1:{int(hub_port)}/session-messages-changed",
        body=b"",
        timeout=HUB_NOTIFICATION_TIMEOUT_SEC,
    )
    if response["status"] != 204:
        raise RuntimeError(f"Hub message notification returned HTTP {response['status']}")
