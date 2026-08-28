from __future__ import annotations

from backend_core.net.http_proxy import read_upstream


HUB_NOTIFICATION_TIMEOUT_SEC = 1.0


def notify_hub_session_messages_changed(hub_port: int, *, scheme: str) -> None:
    if scheme not in {"http", "https"}:
        raise ValueError(f"unsupported Hub scheme: {scheme}")
    response = read_upstream(
        "POST",
        f"{scheme}://127.0.0.1:{int(hub_port)}/session-messages-changed",
        body=b"",
        timeout=HUB_NOTIFICATION_TIMEOUT_SEC,
    )
    if response["status"] != 204:
        raise RuntimeError(f"Hub message notification returned HTTP {response['status']}")
