from __future__ import annotations


def pwa_icon_entries(*, base_path: str = "", pwa_asset_url_fn) -> list[dict[str, str]]:
    return [
        {
            "src": pwa_asset_url_fn("/pwa-icon-192.png", base_path=base_path, bust=True),
            "sizes": "192x192",
            "type": "image/png",
            "purpose": "any",
        },
        {
            "src": pwa_asset_url_fn("/pwa-icon-512.png", base_path=base_path, bust=True),
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "any",
        },
    ]
