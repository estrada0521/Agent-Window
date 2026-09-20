from __future__ import annotations

import json
import os
from pathlib import Path

from backend_core.access.settings import agent_window_root

_BUILTIN_THEME_DIR = Path(__file__).resolve().parents[1] / "assets" / "file-icon-theme"
_USER_THEME_DIRNAME = "file-icon-theme"
_CLIENT_THEME_KEYS = (
    "file",
    "folder",
    "fileExtensions",
    "fileNames",
    "folderNames",
    "light",
    "iconDefinitions",
)
_LIGHT_KEYS = ("file", "folder", "fileExtensions", "fileNames", "folderNames")
_document_cache: tuple[str, int, dict] | None = None


def builtin_file_icon_theme_dir() -> Path:
    return _BUILTIN_THEME_DIR


def user_file_icon_theme_dir() -> Path:
    return agent_window_root() / _USER_THEME_DIRNAME


def resolve_file_icon_theme() -> tuple[Path, Path, str, bool]:
    """Return (theme_json_path, theme_root, theme_id, mono).

    User override is ~/.agent-window/file-icon-theme/theme.json plus the static
    files its iconPath entries point at. No package.json / extension manifest.
    """
    user_root = user_file_icon_theme_dir()
    direct = user_root / "theme.json"
    if direct.is_file():
        return direct.resolve(), user_root.resolve(), "user", False
    builtin = builtin_file_icon_theme_dir()
    theme_json = (builtin / "theme.json").resolve()
    if not theme_json.is_file():
        raise FileNotFoundError(f"built-in file icon theme missing: {theme_json}")
    return theme_json, builtin.resolve(), "agent-window-default", True


def _logical_path(path: Path) -> Path:
    return Path(os.path.normpath(path))


def _is_within(root: Path, path: Path) -> bool:
    try:
        _logical_path(path).relative_to(_logical_path(root))
        return True
    except ValueError:
        return False


def _resolve_icon_file(theme_json: Path, theme_root: Path, icon_path: str) -> Path:
    rel = str(icon_path or "").strip()
    if not rel:
        raise ValueError("iconPath is required")
    logical = theme_json.parent / rel
    if not _is_within(theme_root, logical):
        raise ValueError(f"iconPath escapes theme root: {rel}")
    abs_path = logical.resolve()
    if not abs_path.is_file():
        raise FileNotFoundError(f"icon file missing: {rel}")
    return abs_path


def _assert_icon_path_in_theme(theme_json: Path, theme_root: Path, icon_path: str) -> None:
    rel = str(icon_path or "").strip()
    if not rel:
        raise ValueError("iconPath is required")
    logical = theme_json.parent / rel
    if not _is_within(theme_root, logical):
        raise ValueError(f"iconPath escapes theme root: {rel}")


def _slim_light(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    out = {key: raw[key] for key in _LIGHT_KEYS if key in raw}
    return out or None


def load_file_icon_theme_document() -> dict:
    global _document_cache
    theme_json, theme_root, theme_id, mono = resolve_file_icon_theme()
    mtime_ns = theme_json.stat().st_mtime_ns
    cache_key = str(theme_json)
    if _document_cache and _document_cache[0] == cache_key and _document_cache[1] == mtime_ns:
        return _document_cache[2]
    document = json.loads(theme_json.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("file icon theme must be a JSON object")
    definitions = document.get("iconDefinitions")
    if not isinstance(definitions, dict) or not definitions:
        raise ValueError("file icon theme has no iconDefinitions")
    rewritten: dict[str, dict] = {}
    for icon_id, raw in definitions.items():
        if not isinstance(raw, dict):
            raise ValueError(f"icon definition is not an object: {icon_id}")
        icon_path = str(raw.get("iconPath") or "")
        if mono:
            abs_path = _resolve_icon_file(theme_json, theme_root, icon_path)
            entry = {key: value for key, value in raw.items() if key != "svg"}
            entry["iconPath"] = f"/file-icon-theme/icon/{icon_id}"
            entry["svg"] = abs_path.read_text(encoding="utf-8")
        else:
            _assert_icon_path_in_theme(theme_json, theme_root, icon_path)
            entry = {key: value for key, value in raw.items() if key != "svg"}
            entry["iconPath"] = f"/file-icon-theme/icon/{icon_id}"
        rewritten[str(icon_id)] = entry
    slim = {key: document[key] for key in _CLIENT_THEME_KEYS if key in document and key != "iconDefinitions"}
    if "light" in slim:
        light = _slim_light(slim["light"])
        if light is None:
            slim.pop("light", None)
        else:
            slim["light"] = light
    slim["iconDefinitions"] = rewritten
    payload = {
        "id": theme_id,
        "mono": mono,
        "theme": slim,
    }
    _document_cache = (cache_key, mtime_ns, payload)
    return payload


def file_icon_bytes(icon_id: str) -> bytes:
    key = str(icon_id or "").strip()
    if not key:
        raise ValueError("icon id is required")
    theme_json, theme_root, _theme_id, _mono = resolve_file_icon_theme()
    document = json.loads(theme_json.read_text(encoding="utf-8"))
    definitions = document.get("iconDefinitions") or {}
    raw = definitions.get(key)
    if not isinstance(raw, dict):
        raise FileNotFoundError(f"unknown icon id: {key}")
    abs_path = _resolve_icon_file(theme_json, theme_root, str(raw.get("iconPath") or ""))
    return abs_path.read_bytes()
