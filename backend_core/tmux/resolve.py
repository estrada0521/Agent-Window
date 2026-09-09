from __future__ import annotations

from pathlib import Path


def normalize_workspace(value: str) -> str:
    return str(Path(value).expanduser().resolve())
