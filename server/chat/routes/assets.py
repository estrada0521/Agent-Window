from __future__ import annotations

import json
from urllib.parse import parse_qs

from server.appearance.colors import resolve_theme_palette
from server.pwa import pwa_icon_entries, pwa_url, serve_pwa_file
from server.appearance.file_icon_theme import file_icon_bytes, load_file_icon_theme_document
from server.appearance.theme import resolve_server_theme
from server.appearance.typography import DESKTOP_TEXT_SIZE, MOBILE_TEXT_SIZE, clamp_text_size
from server import APP_DISPLAY_NAME
from server.request import request_base_path
from server.request import request_view_variant
from server.chat.routes.read import _send_bytes


def _get_app_manifest(handler, _parsed, ctx) -> None:
    base_path = request_base_path(headers=handler.headers, query_string=_parsed.query)
    palette = resolve_theme_palette()
    bg = str(palette["dark_bg"])
    body = json.dumps(
        {
            "name": f"{ctx['session_name']} · {APP_DISPLAY_NAME}" if ctx.get("session_name") else APP_DISPLAY_NAME,
            "short_name": ctx["session_name"],
            "display": "standalone",
            "background_color": bg,
            "theme_color": bg,
            "start_url": pwa_url("/", base_path),
            "scope": pwa_url("/", base_path),
            "icons": pwa_icon_entries(base_path),
        },
        ensure_ascii=True,
    ).encode("utf-8")
    _send_bytes(
        handler,
        200,
        body,
        content_type="application/manifest+json; charset=utf-8",
    )


def _send_asset_bytes(handler, reader, name: str, *, content_type: str) -> None:
    try:
        body = reader(name)
    except OSError as exc:
        handler.send_error(500, str(exc))
        return
    if body is None:
        handler.send_response(404)
        handler.end_headers()
        return
    _send_bytes(
        handler,
        200,
        body,
        content_type=content_type,
    )


def _get_icon_asset(handler, parsed, ctx) -> None:
    _send_asset_bytes(
        handler,
        ctx["assets"].icon_bytes,
        parsed.path[6:],
        content_type="image/svg+xml",
    )


def _get_font_asset(handler, parsed, ctx) -> None:
    _send_asset_bytes(
        handler,
        ctx["assets"].font_bytes,
        parsed.path[6:],
        content_type="font/ttf",
    )


def _get_file_icon_theme(handler, _parsed, ctx) -> None:
    del ctx
    try:
        payload = load_file_icon_theme_document()
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        handler.send_error(500, str(exc))
        return
    body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    _send_bytes(handler, 200, body, content_type="application/json; charset=utf-8")


def _get_file_icon_theme_icon(handler, parsed, ctx) -> None:
    del ctx
    from urllib.parse import unquote

    icon_id = unquote(parsed.path[len("/file-icon-theme/icon/") :])
    try:
        body = file_icon_bytes(icon_id)
    except FileNotFoundError:
        handler.send_error(404, f"unknown icon id: {icon_id}")
        return
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        handler.send_error(500, str(exc))
        return
    content_type = "image/svg+xml" if body.lstrip().startswith(b"<") or body.lstrip().startswith(b"<?xml") else "application/octet-stream"
    _send_bytes(handler, 200, body, content_type=content_type, cache_control="private, max-age=31536000, immutable")


def _get_chat_index(handler, parsed, ctx) -> None:
    variant = request_view_variant(headers=handler.headers, query_string=parsed.query)
    query = parse_qs(parsed.query)
    try:
        theme = "dark" if variant == "mobile" else resolve_server_theme(query.get("theme", [""])[0])
        text_size = MOBILE_TEXT_SIZE if variant == "mobile" else clamp_text_size(
            query.get("text_size", [DESKTOP_TEXT_SIZE])[0]
        )
    except (TypeError, ValueError) as exc:
        handler.send_error(400, str(exc))
        return
    body = ctx["render_chat_html_fn"](
        icon_data_uris=ctx["assets"].icon_data_uris,
        server_instance=ctx["server_instance"],
        hub_port=ctx["hub_port"],
        chat_port=ctx["chat_port"],
        chat_base_path=request_base_path(headers=handler.headers, query_string=parsed.query),
        variant=variant,
        session_name=ctx["session_name"],
        theme=theme,
        text_size=text_size,
    ).encode("utf-8")
    _send_bytes(handler, 200, body, content_type="text/html; charset=utf-8")


_GET_ROUTES = {
    "/app.webmanifest": _get_app_manifest,
    "/": _get_chat_index,
    "/index.html": _get_chat_index,
    "/file-icon-theme": _get_file_icon_theme,
}


def dispatch_get_assets_route(handler, parsed, ctx) -> bool:
    if serve_pwa_file(handler, parsed.path):
        return True
    if parsed.path.startswith("/icon/"):
        _get_icon_asset(handler, parsed, ctx)
        return True
    if parsed.path.startswith("/font/"):
        _get_font_asset(handler, parsed, ctx)
        return True
    if parsed.path.startswith("/file-icon-theme/icon/"):
        _get_file_icon_theme_icon(handler, parsed, ctx)
        return True
    route = _GET_ROUTES.get(parsed.path)
    if route is None:
        return False
    route(handler, parsed, ctx)
    return True
