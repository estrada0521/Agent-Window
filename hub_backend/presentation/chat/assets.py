from __future__ import annotations

import json

from backend_core.access.pwa import pwa_url
from backend_core.agents.registry import agent_names_js_set, agent_names_js_array
from .script_assets import CHAT_HEADER_MENU_BUTTON_HTML, CHAT_SHEET_PANELS_HTML
from .render import apply_chat_template_replacements, build_chat_template_replacements
from .template_loader import load_chat_template
from appearance.colors import apply_color_tokens
from appearance.file_icon_theme import load_file_icon_theme_document, resolve_file_icon_theme
from appearance.theme import MOBILE_THEME_DEFAULT
from appearance.typography import DESKTOP_TEXT_SIZE, apply_font_tokens, chat_font_style
from hub_backend.branding import APP_DISPLAY_NAME
from ..hub.header_assets import PAGE_HEADER_CSS, render_page_header

CHAT_DESKTOP_HTML = load_chat_template("desktop")
CHAT_MOBILE_HTML = load_chat_template("mobile")


def render_chat_service_worker_html() -> str:
    return (
        "  <script>\n"
        "    (() => {\n"
        "      if (!(\"serviceWorker\" in navigator)) return;\n"
        "      const isLocalHost = location.hostname === \"localhost\" || location.hostname === \"127.0.0.1\" || location.hostname === \"[::1]\";\n"
        "      if (!(window.isSecureContext || isLocalHost)) return;\n"
        "      const basePath = CHAT_BASE_PATH.replace(/\\/$/, \"\");\n"
        "      const scriptUrl = `${basePath}/service-worker.js`;\n"
        "      const scope = `${basePath || \"\"}/` || \"/\";\n"
        "      window.addEventListener(\"load\", () => {\n"
        "        navigator.serviceWorker.register(scriptUrl, { scope }).catch((err) => {\n"
        "          console.warn(\"chat service worker registration failed\", err);\n"
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


def _normalized_chat_variant(variant: str = "desktop") -> str:
    return "mobile" if str(variant or "").strip().lower() == "mobile" else "desktop"


def _chat_html(variant: str = "desktop") -> str:
    return CHAT_MOBILE_HTML if _normalized_chat_variant(variant) == "mobile" else CHAT_DESKTOP_HTML


def render_chat_html(
    *,
    icon_data_uris,
    server_instance,
    hub_port,
    chat_base_path="",
    variant="desktop",
    session_name="",
    theme="dark",
    text_size=DESKTOP_TEXT_SIZE,
):
    normalized_variant = _normalized_chat_variant(variant)
    base_path = chat_base_path.rstrip("/")
    normalized_session_name = str(session_name or "").strip()
    chat_document_title = f"{normalized_session_name} · {APP_DISPLAY_NAME}" if normalized_session_name else APP_DISPLAY_NAME
    html = _chat_html(normalized_variant)
    for placeholder, value in _agent_css_selectors().items():
        html = html.replace(placeholder, value)
    if normalized_variant == "mobile":
        html = html.replace("__CHAT_HEADER_HTML__", render_page_header(
            title_href="/",
            title_id="pageTitleLink",
            actions_html=CHAT_HEADER_MENU_BUTTON_HTML,
            panels_html=CHAT_SHEET_PANELS_HTML,
        ))
    replacements = build_chat_template_replacements(
        icon_data_uris=icon_data_uris,
        base_path=base_path,
        chat_manifest_url=pwa_url("/app.webmanifest", base_path),
        chat_pwa_icon_192_url=pwa_url("/pwa-icon-192.png", base_path),
        chat_apple_touch_icon_url=pwa_url("/apple-touch-icon.png", base_path),
        chat_service_worker_html=render_chat_service_worker_html(),
        server_instance=server_instance,
        hub_port=hub_port,
        text_size_default=DESKTOP_TEXT_SIZE,
        chat_font_settings_inline_style=chat_font_style(text_size=text_size),
        hub_header_css=PAGE_HEADER_CSS,
        chat_document_title=chat_document_title,
    )
    html = apply_chat_template_replacements(html, replacements)
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
