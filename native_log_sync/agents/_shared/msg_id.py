from __future__ import annotations

import hashlib


def content_msg_id(*parts: object) -> str:
    key = ":".join(str(part) for part in parts)
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]
