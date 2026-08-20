from __future__ import annotations

import json
import re

_ATTACHED_PATH_PATTERN = re.compile(r"\[Attached:\s*([^\]]+)\]")


def attachment_paths(message: str) -> list[str]:
    text = str(message or "")
    return [match.strip() for match in _ATTACHED_PATH_PATTERN.findall(text)]


def build_payload_document(
    *,
    meta: dict,
    targets: list[str],
    has_older: bool,
    entries: list[dict],
) -> dict:
    return {
        **meta,
        "targets": list(targets or []),
        "has_older": bool(has_older),
        "entries": list(entries or []),
    }


def encode_payload_document(document: dict) -> bytes:
    return json.dumps(document, ensure_ascii=True).encode("utf-8")
