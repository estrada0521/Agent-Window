from __future__ import annotations

import base64
from pathlib import Path
from urllib.parse import unquote

from appearance.typography import FONT_ASSET_FILES
from backend_core.agents.names import agent_base_name
from backend_core.agents.registry import icon_file_map


class ChatAssetRuntime:
    def __init__(self, *, repo_root: Path | str):
        repo_root = Path(repo_root).resolve()
        self.icon_files = icon_file_map(repo_root)
        self.fonts_dir = Path.home() / "Library/Fonts"
        self.icon_data_uris = {name: self._icon_data_uri(name) for name in self.icon_files}

    def _icon_data_uri(self, name: str) -> str:
        icon_path = self.icon_files.get(name)
        if not icon_path or not icon_path.is_file():
            return ""
        raw = icon_path.read_bytes()
        return "data:image/svg+xml;base64," + base64.b64encode(raw).decode("ascii")

    @staticmethod
    def resolve_icon_map_key(raw_name: str, icon_files: dict[str, Path]) -> str | None:
        name = unquote((raw_name or "").strip()).lower()
        if not name:
            return None
        if name in icon_files:
            return name
        base = agent_base_name(name)
        if base in icon_files:
            return base
        return None

    def icon_bytes(self, name: str) -> bytes | None:
        key = self.resolve_icon_map_key(name, self.icon_files)
        if not key:
            return None
        path = self.icon_files.get(key)
        if not path:
            return None
        if not path.is_file():
            return None
        return path.read_bytes()

    def font_bytes(self, name: str) -> bytes | None:
        filename = FONT_ASSET_FILES.get(name)
        if not filename:
            return None
        path = self.fonts_dir / filename
        if not path.is_file():
            return None
        return path.read_bytes()
