from __future__ import annotations

from pathlib import Path
import re

_WEB_ROOT = Path(__file__).resolve().parents[1] / "web"
_TIMELINE_DIR = _WEB_ROOT / "timeline"

_STYLE_MARKER = "__TIMELINE_MAIN_STYLE_BLOCK__"
_COMPOSER_MARKER = "__TIMELINE_COMPOSER_HTML__"
_COMPOSER_DROPDOWNS_MARKER = "__TIMELINE_COMPOSER_DROPDOWNS__"
_SCRIPT_MARKER = "__TIMELINE_APP_SCRIPT_BLOCK__"
_INCLUDE_RE = re.compile(r"__INCLUDE:([A-Za-z0-9_./-]+)__")

_COMPOSER_DROPDOWNS_HTML = (
    '<div id="fileDropdown"></div>\n'
    '                <div id="cmdDropdown"></div>'
)


def _read_text(path: Path) -> str:
    if not path.is_file():
        raise FileNotFoundError(f"Template fragment not found: {path}")
    return path.read_text()


def _style_block(css: str) -> str:
    return f"  <style>\n{css}  </style>\n"


def _script_block(js: str) -> str:
    return f"  <script>\n{js}  </script>\n"


def expand_includes(path: Path, stack: tuple[Path, ...] = ()) -> str:
    path = path.resolve()
    if _WEB_ROOT.resolve() not in path.parents:
        raise ValueError(f"Template include escapes web/: {path}")
    if path in stack:
        chain = " -> ".join(str(item) for item in (*stack, path))
        raise ValueError(f"Template include cycle detected: {chain}")
    return _INCLUDE_RE.sub(
        lambda match: expand_includes(path.parent / match.group(1), (*stack, path)),
        _read_text(path),
    )


def load_timeline_template(variant: str) -> str:
    normalized = "mobile" if str(variant or "").strip().lower() == "mobile" else "desktop"
    template_dir = _TIMELINE_DIR / normalized
    shell = expand_includes(template_dir / "shell.html")
    composer = expand_includes(_TIMELINE_DIR / "composer.html")
    if _COMPOSER_DROPDOWNS_MARKER not in composer:
        raise ValueError(f"Timeline composer missing {_COMPOSER_DROPDOWNS_MARKER}")
    composer = composer.replace(
        _COMPOSER_DROPDOWNS_MARKER,
        _COMPOSER_DROPDOWNS_HTML if normalized == "desktop" else "",
        1,
    )
    css = expand_includes(template_dir / "main.css")
    js = expand_includes(template_dir / "app.js")
    if _STYLE_MARKER not in shell:
        raise ValueError(f"Timeline template shell missing {_STYLE_MARKER}: {template_dir / 'shell.html'}")
    if _COMPOSER_MARKER not in shell:
        raise ValueError(f"Timeline template shell missing {_COMPOSER_MARKER}: {template_dir / 'shell.html'}")
    if _SCRIPT_MARKER not in shell:
        raise ValueError(f"Timeline template shell missing {_SCRIPT_MARKER}: {template_dir / 'shell.html'}")
    return (
        shell
        .replace(_COMPOSER_MARKER, composer, 1)
        .replace(_STYLE_MARKER, _style_block(css), 1)
        .replace(_SCRIPT_MARKER, _script_block(js), 1)
    )
