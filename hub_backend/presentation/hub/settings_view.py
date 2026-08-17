from __future__ import annotations

import html

from hub_backend.branding import APP_DISPLAY_NAME
from hub_backend.color_constants import apply_color_tokens
from hub_backend.server_helpers import apply_hub_page_branding


def hub_settings_html(
    *,
    saved: bool,
    load_hub_settings_fn,
    settings_template: str,
    pwa_hub_manifest_url: str,
    pwa_icon_192_url: str,
    pwa_apple_touch_icon_url: str,
    hub_header_css: str,
    hub_header_html: str,
    hub_header_js: str,
    view_variant: str = "desktop",
):
    resolved_view_variant = "mobile" if str(view_variant or "").strip().lower() == "mobile" else "desktop"
    settings = load_hub_settings_fn()
    from backend_core.access.settings import (
        canonicalize_message_font,
        normalize_theme_desktop,
        resolve_hub_theme,
    )

    message_font = canonicalize_message_font(settings.get("message_font"))
    message_text_size = int(settings.get("message_text_size", 13) or 13)
    message_text_size_desktop = int(settings.get("message_text_size_desktop") or message_text_size)

    theme = str(settings.get("theme", "dark") or "dark").strip().lower()
    light_mode = theme == "light"
    theme_desktop = normalize_theme_desktop(settings.get("theme_desktop", theme))
    light_mode_desktop = theme_desktop == "light"
    render_theme = resolve_hub_theme(settings, variant=resolved_view_variant)
    theme_desktop_choices = (
        ("system", "System"),
        ("light", "Light"),
        ("dark", "Dark"),
    )
    theme_desktop_options = "".join(
        f'<option value="{html.escape(value)}"' + (' selected' if value == theme_desktop else '') + f'>{html.escape(label)}</option>'
        for value, label in theme_desktop_choices
    )
    notice = (
        '<div style="margin:0 0 16px;padding:10px 14px;border:1px solid var(--line);'
        'border-radius:8px;color:var(--fg);font-size:13px;">Settings saved.</div>'
        if saved else ""
    )
    page = settings_template
    page = (
        page
        .replace("__HUB_MANIFEST_URL__", pwa_hub_manifest_url)
        .replace("__PWA_ICON_192_URL__", pwa_icon_192_url)
        .replace("__APPLE_TOUCH_ICON_URL__", pwa_apple_touch_icon_url)
        .replace("__NOTICE_HTML__", notice)
        .replace("__MESSAGE_FONT__", html.escape(message_font))
        .replace("__MESSAGE_TEXT_SIZE__", str(message_text_size))
        .replace("__MESSAGE_TEXT_SIZE_DESKTOP__", str(message_text_size_desktop))
        .replace("__LIGHT_MODE_CHECKED__", " checked" if light_mode else "")
        .replace("__LIGHT_MODE_DESKTOP_CHECKED__", " checked" if light_mode_desktop else "")
        .replace("__THEME_DESKTOP_HIDDEN__", html.escape(theme_desktop))
        .replace("__THEME_DESKTOP_OPTIONS__", theme_desktop_options)
        .replace("__VIEW_VARIANT__", resolved_view_variant)
    )
    page = (
        page
        .replace("__HUB_HEADER_CSS__", hub_header_css)
        .replace("__HUB_HEADER_HTML__", hub_header_html)
        .replace("__HUB_HEADER_JS__", hub_header_js)
    )
    page = apply_hub_page_branding(page, page_title=f"Settings · {APP_DISPLAY_NAME}")
    render_settings = dict(settings, theme=render_theme)
    return apply_color_tokens(page, settings=render_settings)
