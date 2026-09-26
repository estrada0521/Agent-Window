from __future__ import annotations

from pathlib import Path

PWA_DIR = Path(__file__).resolve().parents[1] / "web" / "assets" / "pwa"
PWA_FILES: dict[str, tuple[str, str]] = {
    "/pwa-icon-192.png": ("icon-192.png", "image/png"),
    "/pwa-icon-512.png": ("icon-512.png", "image/png"),
    "/apple-touch-icon.png": ("apple-touch-icon.png", "image/png"),
    "/service-worker.js": ("service-worker.js", "application/javascript; charset=utf-8"),
}


def pwa_url(path: str, base_path: str = "") -> str:
    return f"{base_path.rstrip('/')}{path}"


def pwa_icon_entries(base_path: str = "") -> list[dict[str, str]]:
    return [
        {"src": pwa_url(f"/pwa-icon-{size}.png", base_path), "sizes": f"{size}x{size}", "type": "image/png", "purpose": "any"}
        for size in (192, 512)
    ]


def serve_pwa_file(handler, path: str, files: dict[str, tuple[str, str]] = PWA_FILES) -> bool:
    route = files.get(path)
    if not route:
        return False
    filename, content_type = route
    body = (PWA_DIR / filename).read_bytes()
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)
    return True
