from __future__ import annotations


_PWA_STATIC_FILES: dict[str, tuple[str, str]] = {
    "/pwa-icon-192.png": ("icon-192.png", "image/png"),
    "/pwa-icon-512.png": ("icon-512.png", "image/png"),
    "/apple-touch-icon.png": ("apple-touch-icon.png", "image/png"),
    "/service-worker.js": ("service-worker.js", "application/javascript; charset=utf-8"),
}


def pwa_static_routes(extra: dict[str, tuple[str, str]] | None = None) -> dict[str, tuple[str, str, str]]:
    files = dict(_PWA_STATIC_FILES)
    if extra:
        files.update(extra)
    return {
        path: (filename, content_type, "no-store")
        for path, (filename, content_type) in files.items()
    }


def pwa_icon_entries(*, base_path: str = "", pwa_asset_url_fn) -> list[dict[str, str]]:
    return [
        {
            "src": pwa_asset_url_fn("/pwa-icon-192.png", base_path=base_path),
            "sizes": "192x192",
            "type": "image/png",
            "purpose": "any",
        },
        {
            "src": pwa_asset_url_fn("/pwa-icon-512.png", base_path=base_path),
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "any",
        },
    ]
