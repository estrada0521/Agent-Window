from __future__ import annotations

import json

from server import APP_DISPLAY_NAME


def build_room_template_replacements(
    *,
    icon_data_uris: dict,
    base_path: str,
    room_manifest_url: str,
    room_pwa_icon_192_url: str,
    room_apple_touch_icon_url: str,
    room_service_worker_html: str,
    server_instance: str,
    hub_port: int,
    room_port: int,
    text_size_default: int,
    room_font_settings_inline_style: str,
    hub_header_css: str,
    room_document_title: str = APP_DISPLAY_NAME,
) -> dict[str, str]:
    return {
        "__ICON_DATA_URIS__": json.dumps(icon_data_uris, ensure_ascii=True),
        "__ROOM_BASE_PATH__": base_path,
        "__ROOM_MANIFEST_URL__": room_manifest_url,
        "__ROOM_PWA_ICON_192_URL__": room_pwa_icon_192_url,
        "__ROOM_APPLE_TOUCH_ICON_URL__": room_apple_touch_icon_url,
        "__ROOM_SERVICE_WORKER_HTML__": room_service_worker_html,
        "__SERVER_INSTANCE__": server_instance,
        "__HUB_PORT__": str(hub_port),
        "__ROOM_PORT__": str(room_port),
        "__TEXT_SIZE_DEFAULT__": str(text_size_default),
        "__ROOM_FONT_SETTINGS_INLINE_STYLE__": room_font_settings_inline_style,
        "__HUB_HEADER_CSS__": hub_header_css,
        "__APP_DISPLAY_NAME__": APP_DISPLAY_NAME,
        "__ROOM_DOCUMENT_TITLE__": room_document_title,
    }


def apply_room_template_replacements(template: str, replacements: dict[str, str]) -> str:
    html = template
    for placeholder, value in replacements.items():
        html = html.replace(placeholder, value)
    return html
