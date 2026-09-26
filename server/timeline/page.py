from __future__ import annotations

import json

from server.pwa import pwa_url
from agents.registry import agent_names_js_set, agent_names_js_array
from server.timeline.page_scripts import TIMELINE_HEADER_MENU_BUTTON_HTML, TIMELINE_SHEET_PANELS_HTML
from server.template import load_timeline_template
from server.appearance.colors import apply_color_tokens
from server.timeline.file_icon_theme import load_file_icon_theme_document, resolve_file_icon_theme
from server.appearance.colors import MOBILE_THEME_DEFAULT
from server.appearance.typography import DESKTOP_TEXT_SIZE, apply_font_tokens, timeline_font_style
from server import APP_DISPLAY_NAME
from server.page_header import PAGE_HEADER_CSS, render_page_header

TIMELINE_DESKTOP_HTML = load_timeline_template("desktop")
TIMELINE_MOBILE_HTML = load_timeline_template("mobile")


def build_timeline_template_replacements(
    *,
    icon_data_uris: dict,
    base_path: str,
    timeline_manifest_url: str,
    timeline_pwa_icon_192_url: str,
    timeline_apple_touch_icon_url: str,
    timeline_service_worker_html: str,
    server_instance: str,
    hub_port: int,
    timeline_port: int,
    text_size_default: int,
    timeline_font_settings_inline_style: str,
    hub_header_css: str,
    timeline_document_title: str = APP_DISPLAY_NAME,
) -> dict[str, str]:
    return {
        "__ICON_DATA_URIS__": json.dumps(icon_data_uris, ensure_ascii=True),
        "__TIMELINE_BASE_PATH__": base_path,
        "__TIMELINE_MANIFEST_URL__": timeline_manifest_url,
        "__TIMELINE_PWA_ICON_192_URL__": timeline_pwa_icon_192_url,
        "__TIMELINE_APPLE_TOUCH_ICON_URL__": timeline_apple_touch_icon_url,
        "__TIMELINE_SERVICE_WORKER_HTML__": timeline_service_worker_html,
        "__SERVER_INSTANCE__": server_instance,
        "__HUB_PORT__": str(hub_port),
        "__TIMELINE_PORT__": str(timeline_port),
        "__TEXT_SIZE_DEFAULT__": str(text_size_default),
        "__TIMELINE_FONT_SETTINGS_INLINE_STYLE__": timeline_font_settings_inline_style,
        "__HUB_HEADER_CSS__": hub_header_css,
        "__APP_DISPLAY_NAME__": APP_DISPLAY_NAME,
        "__TIMELINE_DOCUMENT_TITLE__": timeline_document_title,
    }


def apply_timeline_template_replacements(template: str, replacements: dict[str, str]) -> str:
    html = template
    for placeholder, value in replacements.items():
        html = html.replace(placeholder, value)
    return html


def render_timeline_service_worker_html() -> str:
    return (
        "  <script>\n"
        "    (() => {\n"
        "      if (!(\"serviceWorker\" in navigator)) return;\n"
        "      const isLocalHost = location.hostname === \"localhost\" || location.hostname === \"127.0.0.1\" || location.hostname === \"[::1]\";\n"
        "      if (!(window.isSecureContext || isLocalHost)) return;\n"
        "      const basePath = TIMELINE_BASE_PATH.replace(/\\/$/, \"\");\n"
        "      const scriptUrl = `${basePath}/service-worker.js`;\n"
        "      const scope = `${basePath || \"\"}/` || \"/\";\n"
        "      window.addEventListener(\"load\", () => {\n"
        "        navigator.serviceWorker.register(scriptUrl, { scope }).catch((err) => {\n"
        "          console.warn(\"timeline service worker registration failed\", err);\n"
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


def _normalized_timeline_variant(variant: str = "desktop") -> str:
    return "mobile" if str(variant or "").strip().lower() == "mobile" else "desktop"


def _timeline_html(variant: str = "desktop") -> str:
    return TIMELINE_MOBILE_HTML if _normalized_timeline_variant(variant) == "mobile" else TIMELINE_DESKTOP_HTML


def render_timeline_html(
    *,
    icon_data_uris,
    server_instance,
    hub_port,
    timeline_port,
    timeline_base_path="",
    variant="desktop",
    timeline_name="",
    theme="dark",
    text_size=DESKTOP_TEXT_SIZE,
):
    normalized_variant = _normalized_timeline_variant(variant)
    base_path = timeline_base_path.rstrip("/")
    normalized_timeline_name = str(timeline_name or "").strip()
    timeline_document_title = f"{normalized_timeline_name} · {APP_DISPLAY_NAME}" if normalized_timeline_name else APP_DISPLAY_NAME
    html = _timeline_html(normalized_variant)
    for placeholder, value in _agent_css_selectors().items():
        html = html.replace(placeholder, value)
    if normalized_variant == "mobile":
        html = html.replace("__TIMELINE_HEADER_HTML__", render_page_header(
            title_href="/",
            title_id="pageTitleLink",
            actions_html=TIMELINE_HEADER_MENU_BUTTON_HTML,
            panels_html=TIMELINE_SHEET_PANELS_HTML,
        ))
    replacements = build_timeline_template_replacements(
        icon_data_uris=icon_data_uris,
        base_path=base_path,
        timeline_manifest_url=pwa_url("/app.webmanifest", base_path),
        timeline_pwa_icon_192_url=pwa_url("/pwa-icon-192.png", base_path),
        timeline_apple_touch_icon_url=pwa_url("/apple-touch-icon.png", base_path),
        timeline_service_worker_html=render_timeline_service_worker_html(),
        server_instance=server_instance,
        hub_port=hub_port,
        timeline_port=timeline_port,
        text_size_default=DESKTOP_TEXT_SIZE,
        timeline_font_settings_inline_style=timeline_font_style(text_size=text_size),
        hub_header_css=PAGE_HEADER_CSS,
        timeline_document_title=timeline_document_title,
    )
    html = apply_timeline_template_replacements(html, replacements)
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
