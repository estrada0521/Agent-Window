from __future__ import annotations

import html
import json
import subprocess
from pathlib import Path

from server import APP_DISPLAY_NAME
from server.template import expand_includes
from server.appearance.colors import DARK_BG


def apply_hub_page_branding(html: str, *, page_title: str) -> str:
    return (
        html
        .replace("__APP_DISPLAY_NAME__", APP_DISPLAY_NAME)
        .replace("__PAGE_TITLE__", page_title)
    )


def format_room_url(room_port: int, path: str) -> str:
    suffix = path if path.startswith("/") else f"/{path}"
    return f"/{int(room_port)}{suffix}"


PROCESS_HANDOFF_TIMEOUT_SEC = 8.0


def launch_hub_restart(*, script_path, repo_root, hub_server) -> str:
    hub_server.shutdown()
    hub_server.server_close()
    try:
        completed = subprocess.run(
            ["bash", str(script_path)],
            cwd=repo_root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            check=False,
            timeout=PROCESS_HANDOFF_TIMEOUT_SEC,
        )
    except subprocess.TimeoutExpired:
        return f"bin/hub did not finish within {PROCESS_HANDOFF_TIMEOUT_SEC:g}s"
    return "" if completed.returncode == 0 else completed.stderr.strip() or f"bin/hub exited {completed.returncode}"


def error_page(message) -> str:
    text = str(message or "").strip()
    escaped = html.escape(text)
    payload = json.dumps(text)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Hub</title><style>:root{{color-scheme:dark;--fg:rgb(180, 180, 180);--muted:rgb(128, 128, 128)}}html,body{{margin:0;min-height:100%;background:{DARK_BG};color:var(--fg);font-family:var(--font-main)}}body{{display:grid;place-items:center;padding:24px}}.note{{font-size:13px;line-height:1.5;color:var(--muted)}}</style></head><body><div class="note">{escaped}</div><p><a href="/">Back to Hub</a></p><script>(()=>{{const message={payload};sessionStorage.setItem("agent_window_hub_pending_error",message);window.location.replace("/");}})();</script><noscript><p><a href="/">Back to Hub</a></p></noscript></body></html>"""


def build_hub_html_pages(
    *,
    desktop_template_dir: Path,
    mobile_template_dir: Path,
    pwa_hub_manifest_url: str,
    pwa_icon_192_url: str,
    pwa_apple_touch_icon_url: str,
    hub_header_css: str,
    hub_header_html: str,
    hub_header_html_mobile: str,
    hub_header_js: str,
) -> dict[str, str]:
    def _render_hub_home_html(own_dir: Path, *, header_html: str) -> str:
        template_path = own_dir / "home.html"
        if not template_path.is_file():
            raise FileNotFoundError(f"Hub home template not found: {template_path}")
        html = expand_includes(template_path)
        html = (
            html
            .replace("__HUB_MANIFEST_URL__", pwa_hub_manifest_url)
            .replace("__PWA_ICON_192_URL__", pwa_icon_192_url)
            .replace("__APPLE_TOUCH_ICON_URL__", pwa_apple_touch_icon_url)
            .replace("__HUB_HEADER_CSS__", hub_header_css)
            .replace("__HUB_HEADER_HTML__", header_html)
            .replace("__HUB_HEADER_JS__", hub_header_js)
        )
        return apply_hub_page_branding(html, page_title=APP_DISPLAY_NAME)

    hub_home_desktop_html = _render_hub_home_html(desktop_template_dir, header_html=hub_header_html)
    hub_home_mobile_html = _render_hub_home_html(mobile_template_dir, header_html=hub_header_html_mobile)
    return {
        "hub_home_html_desktop": hub_home_desktop_html,
        "hub_home_html_mobile": hub_home_mobile_html,
    }
