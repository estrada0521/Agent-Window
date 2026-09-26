from __future__ import annotations

import json

from server.pwa import pwa_url
from agents.registry import agent_names_js_set, agent_names_js_array
from server.room.page_scripts import ROOM_HEADER_MENU_BUTTON_HTML, ROOM_SHEET_PANELS_HTML
from server.room.page_render import apply_room_template_replacements, build_room_template_replacements
from server.template import load_room_template
from server.appearance.colors import apply_color_tokens
from server.appearance.file_icon_theme import load_file_icon_theme_document, resolve_file_icon_theme
from server.appearance.theme import MOBILE_THEME_DEFAULT
from server.appearance.typography import DESKTOP_TEXT_SIZE, apply_font_tokens, room_font_style
from server import APP_DISPLAY_NAME
from server.page_header import PAGE_HEADER_CSS, render_page_header

ROOM_DESKTOP_HTML = load_room_template("desktop")
ROOM_MOBILE_HTML = load_room_template("mobile")


def render_room_service_worker_html() -> str:
    return (
        "  <script>\n"
        "    (() => {\n"
        "      if (!(\"serviceWorker\" in navigator)) return;\n"
        "      const isLocalHost = location.hostname === \"localhost\" || location.hostname === \"127.0.0.1\" || location.hostname === \"[::1]\";\n"
        "      if (!(window.isSecureContext || isLocalHost)) return;\n"
        "      const basePath = ROOM_BASE_PATH.replace(/\\/$/, \"\");\n"
        "      const scriptUrl = `${basePath}/service-worker.js`;\n"
        "      const scope = `${basePath || \"\"}/` || \"/\";\n"
        "      window.addEventListener(\"load\", () => {\n"
        "        navigator.serviceWorker.register(scriptUrl, { scope }).catch((err) => {\n"
        "          console.warn(\"room service worker registration failed\", err);\n"
        "        });\n"
        "      }, { once: true });\n"
        "    })();\n"
        "  </script>"
    )


def _agent_css_selectors() -> dict[str, str]:
    def _sel(suffix="", prefix=""):
        return f"    {prefix}.message:not(.user):not(.system){suffix}"
    def _row_sel(inner):
        return f"    .message-row:not(.user):not(.system) {inner}"
    def _cross(suffixes, prefix=""):
        parts = [f"    {prefix}.message:not(.user):not(.system) .md-body {s}" for s in suffixes]
        return ",\n".join(parts)
    return {
        "__AGENT_MESSAGE_SELECTORS__": _sel(),
        "__AGENT_ROW_MESSAGE_SELECTORS__": _row_sel(".message"),
        "__AGENT_SEL_MD_BODY__": _sel(" .md-body"),
        "__AGENT_SEL_MD_HEADING__": _cross(["h1", "h2", "h3", "h4"]),
        "__AGENT_SEL_MD_BODY_TEXT__": _cross(["p", "li", "blockquote"]),
        "__AGENT_ICON_NAMES_JS_SET__": agent_names_js_set(),
        "__ALL_BASE_AGENTS_JS_ARRAY__": agent_names_js_array(),
    }


def _normalized_room_variant(variant: str = "desktop") -> str:
    return "mobile" if str(variant or "").strip().lower() == "mobile" else "desktop"


def _room_html(variant: str = "desktop") -> str:
    return ROOM_MOBILE_HTML if _normalized_room_variant(variant) == "mobile" else ROOM_DESKTOP_HTML


def render_room_html(
    *,
    icon_data_uris,
    server_instance,
    hub_port,
    room_port,
    room_base_path="",
    variant="desktop",
    timeline_label="",
    theme="dark",
    text_size=DESKTOP_TEXT_SIZE,
):
    normalized_variant = _normalized_room_variant(variant)
    base_path = room_base_path.rstrip("/")
    normalized_timeline_label = str(timeline_label or "").strip()
    room_document_title = f"{normalized_timeline_label} · {APP_DISPLAY_NAME}" if normalized_timeline_label else APP_DISPLAY_NAME
    html = _room_html(normalized_variant)
    for placeholder, value in _agent_css_selectors().items():
        html = html.replace(placeholder, value)
    if normalized_variant == "mobile":
        html = html.replace("__ROOM_HEADER_HTML__", render_page_header(
            title_href="/",
            title_id="pageTitleLink",
            actions_html=ROOM_HEADER_MENU_BUTTON_HTML,
            panels_html=ROOM_SHEET_PANELS_HTML,
        ))
    replacements = build_room_template_replacements(
        icon_data_uris=icon_data_uris,
        base_path=base_path,
        room_manifest_url=pwa_url("/app.webmanifest", base_path),
        room_pwa_icon_192_url=pwa_url("/pwa-icon-192.png", base_path),
        room_apple_touch_icon_url=pwa_url("/apple-touch-icon.png", base_path),
        room_service_worker_html=render_room_service_worker_html(),
        server_instance=server_instance,
        hub_port=hub_port,
        room_port=room_port,
        text_size_default=DESKTOP_TEXT_SIZE,
        room_font_settings_inline_style=room_font_style(text_size=text_size),
        hub_header_css=PAGE_HEADER_CSS,
        room_document_title=room_document_title,
    )
    html = apply_room_template_replacements(html, replacements)
    html = apply_font_tokens(html)
    html = apply_color_tokens(
        html,
        theme=theme,
        mobile_theme_default=MOBILE_THEME_DEFAULT,
    )
    _theme_json, inline = resolve_file_icon_theme()
    if inline:
        boot = load_file_icon_theme_document()
        boot_json = json.dumps(boot, ensure_ascii=True).replace("<", "\\u003c")
        html = html.replace("</head>", f"<script>window.__FILE_ICON_THEME__={boot_json};</script></head>", 1)
    return html
