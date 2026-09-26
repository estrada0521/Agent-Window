from __future__ import annotations

import json

from server import APP_DISPLAY_NAME


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
