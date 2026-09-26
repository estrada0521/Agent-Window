from __future__ import annotations

import re
from urllib.parse import parse_qs


_SAFE_BASE_PATH_RE = re.compile(r"^/(?:[A-Za-z0-9._~!$&()*+,;=:@%-]+(?:/[A-Za-z0-9._~!$&()*+,;=:@%-]+)*)?$")


def normalize_request_base_path(value: str) -> str:
    raw = str(value or "").strip().rstrip("/")
    if not raw:
        return ""
    if not _SAFE_BASE_PATH_RE.fullmatch(raw):
        return ""
    return raw


def request_base_path(*, headers, query_string: str = "") -> str:
    forwarded = normalize_request_base_path(headers.get("X-Forwarded-Prefix", ""))
    if forwarded:
        return forwarded
    qs = parse_qs(query_string or "", keep_blank_values=False)
    return normalize_request_base_path((qs.get("base_path", [""])[0] or ""))


def _normalized_view(value: str, *, default: str = "desktop") -> str:
    lowered = str(value or "").strip().lower()
    if lowered == "mobile":
        return "mobile"
    if lowered == "desktop":
        return "desktop"
    return default


def request_view_variant(*, headers, query_string: str = "", default: str = "desktop") -> str:
    qs = parse_qs(query_string or "", keep_blank_values=False)
    query_view = (qs.get("view", [""])[0] or "").strip()
    if query_view:
        return _normalized_view(query_view, default=default)

    ch_mobile = (headers.get("Sec-CH-UA-Mobile", "") or "").strip().lower()
    if ch_mobile in {"?1", "1", "true"}:
        return "mobile"
    if ch_mobile in {"?0", "0", "false"}:
        return "desktop"

    user_agent = (headers.get("User-Agent", "") or "").lower()
    mobile_tokens = (
        "iphone",
        "ipod",
        "android",
        "mobile",
        "opera mini",
        "blackberry",
        "iemobile",
        "silk/",
    )
    if any(token in user_agent for token in mobile_tokens):
        return "mobile"
    return default
