from __future__ import annotations

import json
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[2] / "web" / "syntax.js"


def add_syntax_highlighting(page: str, *, filename: str = "", theme: str = "dark") -> str:
    themes = {}
    for mode in ("light", "dark"):
        path = Path.home() / ".agent-window" / f"syntax-{mode}.css"
        if path.is_symlink() or path.exists():
            themes[mode] = path.read_text(encoding="utf-8")
    if not themes:
        return page
    config = json.dumps({"themes": themes, "filename": filename, "theme": theme}, ensure_ascii=True).replace("<", "\\u003c")
    script = _SCRIPT.read_text(encoding="utf-8")
    return page.replace("</head>", f'<script id="syntax-config" type="application/json">{config}</script><script>{script}</script></head>', 1)
