from __future__ import annotations

import base64
from pathlib import Path
from urllib.parse import unquote

from backend_core.agents.names import agent_base_name
from backend_core.agents.registry import icon_file_map


class ChatAssetRuntime:
    def __init__(self, *, repo_root: Path | str):
        repo_root = Path(repo_root).resolve()
        self.icon_files = icon_file_map(repo_root)
        self.font_files = {
            "anthropic-serif-roman.ttf": [
                Path.home() / "Library/Fonts/AnthropicSerif-Romans-Variable-25x258.ttf",
                Path("/Applications/Claude.app/Contents/Resources/fonts/AnthropicSerif-Romans-Variable-25x258.ttf"),
            ],
            "anthropic-serif-italic.ttf": [
                Path.home() / "Library/Fonts/AnthropicSerif-Italics-Variable-25x258.ttf",
                Path("/Applications/Claude.app/Contents/Resources/fonts/AnthropicSerif-Italics-Variable-25x258.ttf"),
            ],
            "anthropic-sans-roman.ttf": [
                Path("/Applications/Claude.app/Contents/Resources/fonts/AnthropicSans-Romans-Variable-25x258.ttf"),
            ],
            "anthropic-sans-italic.ttf": [
                Path("/Applications/Claude.app/Contents/Resources/fonts/AnthropicSans-Italics-Variable-25x258.ttf"),
            ],
            "jetbrains-mono.ttf": [
                # "JetBrainsMono-Variable.ttf" is not a name any real install
                # of this font produces -- the Homebrew cask (font-jetbrains-
                # mono) installs it as "JetBrainsMono[wght].ttf". Whatever
                # used to sit at the old path wasn't a real install of this
                # font at all (verified corrupt: HTML, not font data).
                Path.home() / "Library/Fonts/JetBrainsMono[wght].ttf",
                Path("/System/Library/Fonts/Supplemental/JetBrainsMono-Variable.ttf"),
            ],
        }
        self.icon_data_uris = {name: self._icon_data_uri(name) for name in self.icon_files}

    def _icon_data_uri(self, name: str) -> str:
        icon_path = self.icon_files.get(name)
        if not icon_path or not icon_path.is_file():
            return ""
        raw = icon_path.read_bytes()
        return "data:image/svg+xml;base64," + base64.b64encode(raw).decode("ascii")

    def resolve_font_file(self, name: str) -> Path | None:
        for candidate in self.font_files.get(name, []):
            if candidate.exists():
                return candidate
        return None

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
        path = self.resolve_font_file(name)
        if not path:
            return None
        return path.read_bytes()
