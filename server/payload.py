from __future__ import annotations

import json
def build_payload_document(
    *,
    server_instance: str,
    has_older: bool,
    entries: list[dict],
) -> dict:
    return {
        "server_instance": str(server_instance),
        "has_older": bool(has_older),
        "entries": list(entries or []),
    }


def encode_payload_document(document: dict) -> bytes:
    return json.dumps(document, ensure_ascii=True).encode("utf-8")
