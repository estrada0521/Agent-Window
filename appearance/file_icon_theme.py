from __future__ import annotations

import json
from pathlib import Path

from backend_core.access.settings import agent_window_root

_BUILTIN_THEME_JSON = Path(__file__).resolve().parents[1] / "assets" / "file-icon-theme" / "theme.json"


def resolve_file_icon_theme() -> tuple[Path, bool]:
    user_theme = agent_window_root() / "file-icon-theme" / "theme.json"
    if user_theme.is_file():
        return user_theme.resolve(), False
    return _BUILTIN_THEME_JSON.resolve(), True


def _icon_file(theme_json: Path, icon_id: str, raw: object) -> Path:
    if not isinstance(raw, dict) or not raw.get("iconPath"):
        raise ValueError(f"icon definition needs iconPath: {icon_id}")
    return theme_json.parent / raw["iconPath"]


def load_file_icon_theme_document() -> dict:
    theme_json, inline = resolve_file_icon_theme()
    document = json.loads(theme_json.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("file icon theme must be a JSON object")
    definitions = document.get("iconDefinitions")
    if not isinstance(definitions, dict) or not definitions:
        raise ValueError("file icon theme has no iconDefinitions")
    rewritten: dict[str, dict] = {}
    for icon_id, raw in definitions.items():
        icon_file = _icon_file(theme_json, icon_id, raw)
        entry = {**raw, "iconPath": f"/file-icon-theme/icon/{icon_id}"}
        if inline:
            entry["svg"] = icon_file.read_text(encoding="utf-8")
        rewritten[icon_id] = entry
    return {"inline": inline, "theme": {**document, "iconDefinitions": rewritten}}


def file_icon_bytes(icon_id: str) -> bytes:
    theme_json, _inline = resolve_file_icon_theme()
    document = json.loads(theme_json.read_text(encoding="utf-8"))
    raw = (document.get("iconDefinitions") or {}).get(icon_id)
    if raw is None:
        raise FileNotFoundError(f"unknown icon id: {icon_id}")
    return _icon_file(theme_json, icon_id, raw).read_bytes()
