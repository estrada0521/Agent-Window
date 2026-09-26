from __future__ import annotations

import os
import re
from urllib.parse import unquote, urlparse


def display_path(value: object, *, workspace: str = "") -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if re.match(r"^[a-z][a-z0-9+.-]*://", text, re.IGNORECASE):
        if not text.lower().startswith("file://"):
            return text
        try:
            parsed = urlparse(text)
            text = unquote(parsed.path or "").strip()
        except Exception:
            return text
    if not text:
        return ""
    normalized = os.path.normpath(text)
    if not os.path.isabs(normalized):
        return normalized.replace(os.sep, "/")
    normalized_real = os.path.realpath(normalized)
    root = str(workspace or "").strip()
    if root:
        rel = os.path.relpath(normalized_real, os.path.realpath(root))
        if rel == ".":
            return "."
        if rel != ".." and not rel.startswith(f"..{os.sep}"):
            return rel.replace(os.sep, "/")
    return normalized_real.replace(os.sep, "/")
