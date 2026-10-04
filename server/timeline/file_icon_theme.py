from __future__ import annotations

import json
import os
from pathlib import Path

from fs.log.paths import agent_window_root

_BUILTIN_THEME_JSON = Path(__file__).resolve().parents[2] / "web" / "assets" / "file-icon-theme" / "theme.json"


def _icon_file(theme_json: Path, icon_id: str, raw: object) -> Path:
    if not isinstance(raw, dict) or not raw.get("iconPath"):
        raise ValueError(f"icon definition needs iconPath: {icon_id}")
    return theme_json.parent / raw["iconPath"]


def _read_theme(theme_json: Path) -> dict:
    document = json.loads(theme_json.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("file icon theme must be a JSON object")
    definitions = document.get("iconDefinitions")
    if not isinstance(definitions, dict) or not definitions:
        raise ValueError("file icon theme has no iconDefinitions")
    for icon_id, raw in definitions.items():
        _icon_file(theme_json, icon_id, raw)
    return document


def _file_icon_theme() -> tuple[Path, dict, bool, str]:
    user_theme = agent_window_root() / "file-icon-theme.json"
    warning = ""
    if os.path.lexists(user_theme):
        try:
            theme_json = user_theme.resolve(strict=True)
            return theme_json, _read_theme(theme_json), False, warning
        except (OSError, ValueError):
            warning = "Icon theme unavailable"
    return _BUILTIN_THEME_JSON, _read_theme(_BUILTIN_THEME_JSON), True, warning


def load_file_icon_theme_document() -> dict:
    theme_json, document, inline, warning = _file_icon_theme()
    version = theme_json.stat().st_mtime_ns
    rewritten: dict[str, dict] = {}
    for icon_id, raw in document["iconDefinitions"].items():
        icon_file = _icon_file(theme_json, icon_id, raw)
        entry = {**raw, "iconPath": f"/file-icon-theme/icon/{icon_id}?v={version}"}
        if inline:
            entry["svg"] = icon_file.read_text(encoding="utf-8")
        rewritten[icon_id] = entry
    return {"inline": inline, "theme": {**document, "iconDefinitions": rewritten}, "warning": warning}


def file_icon_bytes(icon_id: str) -> bytes:
    theme_json, document, _inline, _warning = _file_icon_theme()
    raw = (document.get("iconDefinitions") or {}).get(icon_id)
    if raw is None:
        raise FileNotFoundError(f"unknown icon id: {icon_id}")
    return _icon_file(theme_json, icon_id, raw).read_bytes()
