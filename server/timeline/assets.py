from __future__ import annotations

import base64
from pathlib import Path
from urllib.parse import unquote

from fs.log.paths import agent_window_root
from agents import agent_base_name
from agents.registry import icon_file_map


class TimelineAssets:
    def __init__(self):
        self.icon_files = icon_file_map()
        self.fonts_dir = agent_window_root() / "fonts"
        self.icon_data_uris = {
            name: "data:image/svg+xml;base64," + base64.b64encode(path.read_bytes()).decode("ascii")
            for name, path in self.icon_files.items()
        }

    def icon_bytes(self, name: str) -> bytes | None:
        path = self.icon_files.get(agent_base_name(unquote(name)))
        return path.read_bytes() if path is not None else None

    def font_bytes(self, name: str) -> bytes | None:
        name = unquote(name)
        if name in ("", ".", "..") or Path(name).name != name:
            return None
        path = self.fonts_dir / name
        if not path.is_file():
            return None
        return path.read_bytes()
