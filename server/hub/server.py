from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from server.hub.hub import Hub
from server.appearance.colors import apply_color_tokens, resolve_theme_palette
from server.appearance.theme import DESKTOP_THEME_DEFAULT, MOBILE_THEME_DEFAULT
from server.appearance.typography import DESKTOP_TEXT_SIZE, TEXT_SIZE_MAX, TEXT_SIZE_MIN, apply_font_tokens
from server.pwa import PWA_FILES, pwa_icon_entries, serve_pwa_file
from server.hub.session_proxy import proxy_chat_session
from server.hub.session_api import split_chat_proxy_path
from server.hub.chat_supervisor import stop_inactive_chat_servers
from server.page_header import (
    PAGE_HEADER_CSS,
    PAGE_HEADER_JS,
    MOBILE_HUB_HEADER_ACTIONS,
    render_page_header,
)
from server.hub.session_query import (
    active_session_records,
    archived_session_records,
    live_sessions_query,
)

from server import APP_DISPLAY_NAME
from server.hub.new_session import (
    post_pick_workspace as _post_pick_workspace_action,
    post_start_session_draft as _post_start_session_draft_action,
)
from server.hub.actions import (
    get_delete_archived_session as _get_delete_archived_session_action,
    get_kill_session as _get_kill_session_action,
    get_open_session as _get_open_session_action,
    get_revive_session as _get_revive_session_action,
    get_session_workspace as _get_session_workspace_action,
    post_change_session_workspace as _post_change_session_workspace_action,
    post_rename_session as _post_rename_session_action,
    post_reset_session_agents as _post_reset_session_agents_action,
    post_restart_hub as _post_restart_hub_action,
)
from server.hub.server_helpers import (
    build_hub_html_pages as _build_hub_html_pages_impl,
    error_page,
    format_chat_url,
    launch_hub_restart,
)
from server.request import request_view_variant

_initialized = False
repo_root = Path()
script_path = Path()
port = 0
hub = None
restart_lock = threading.Lock()
restart_pending = False
_restart_release_event = threading.Event()
hub_server = None


def initialize_from_argv(argv: list[str] | None = None) -> None:
    global _initialized
    global repo_root, script_path, port, hub
    global restart_pending, hub_server

    if _initialized:
        return

    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 2:
        raise SystemExit("usage: python -m server.hub.server <repo_root> <script_path>")

    root_arg, script_arg = args
    repo_root = Path(root_arg).resolve()
    script_path = Path(script_arg).resolve()
    port = int((repo_root / "hub-port").read_text().strip())
    hub = Hub(repo_root, hub_port=port)
    restart_pending, hub_server = False, None

    _initialized = True


def queue_hub_restart():
    global restart_pending
    with restart_lock:
        if restart_pending:
            return False, "restart already pending", False
        cleanup_detail = stop_inactive_chat_servers()
        if cleanup_detail:
            return False, cleanup_detail, False
        restart_pending = True
    detail = launch_hub_restart(script_path=script_path, repo_root=repo_root, hub_server=hub_server)
    return not detail, detail, True


def release_restart_hold():
    _restart_release_event.set()

_HUB_PWA_FILES = {
    **PWA_FILES,
    "/hub-service-worker.js": ("service-worker.js", "application/javascript; charset=utf-8"),
}

_PAGE_HEADER_CSS = PAGE_HEADER_CSS
_PAGE_HEADER_HTML = render_page_header()
_PAGE_HEADER_HTML_MOBILE = render_page_header(actions_html=MOBILE_HUB_HEADER_ACTIONS)
_PAGE_HEADER_JS = PAGE_HEADER_JS
_HUB_LAUNCH_SHELL_BODY_HTML = (
    '<div class="launch-shell-card" id="launchShellCard">'
    '<span class="launch-shell-title">Agent Window</span>'
    "</div>"
)
HUB_LAUNCH_SHELL_HTML = f"""<!doctype html>
<html lang="en" data-theme-desktop="__THEME_DESKTOP__" data-theme-mobile="__THEME_MOBILE__" data-view="__VIEW_VARIANT__">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <script>
    (() => {{
      if (document.documentElement.dataset.view === "mobile") {{
        let setting = document.documentElement.dataset.themeMobile;
        const stored = String(localStorage.getItem("agent_window_theme_mobile") || "").trim().toLowerCase();
        if (["system", "light", "dark"].includes(stored)) setting = stored;
        document.documentElement.dataset.themeMobile = setting;
        return;
      }}
      const stored = String(localStorage.getItem("agent_window_theme_desktop") || "").trim().toLowerCase();
      if (["system", "light", "dark"].includes(stored)) {{
        document.documentElement.dataset.themeDesktop = stored;
      }}
    }})();
  </script>
  <meta name="theme-color" content="__DARK_BG__">
  <title>{APP_DISPLAY_NAME}</title>
  <style>
    :root {{ color-scheme: __COLOR_SCHEME__; --bg: __DARK_BG__; --fg: __LIGHT_FG__; }}
    html[data-view="desktop"][data-theme-desktop="light"] {{
      color-scheme: light;
      --bg: __DESKTOP_HUB_LIGHT_BG__;
      --fg: __SYSTEM_LIGHT_FG__;
    }}
    html[data-theme-desktop="dark"] {{ --launch-shell-title-fg: rgb(255,255,255); }}
    html, body {{
      margin: 0;
      min-height: 100%;
      background: var(--bg);
      color: var(--fg);
    }}
    html[data-view="mobile"] {{ --bg: __MOBILE_HUB_DARK_BG__; }}
    html[data-view="mobile"][data-theme-mobile="light"] {{ --bg: __MOBILE_HUB_LIGHT_BG__; }}
    html[data-native-app="1"],
    html[data-native-app="1"] body {{ background: transparent; }}
    @media (prefers-color-scheme: light) {{
      html[data-theme-desktop="system"] {{
        color-scheme: light;
        --bg: __DESKTOP_HUB_LIGHT_BG__;
        --fg: __SYSTEM_LIGHT_FG__;
      }}
      html[data-view="mobile"][data-theme-mobile="system"] {{ --bg: __MOBILE_HUB_LIGHT_BG__; }}
    }}
    @media (prefers-color-scheme: dark) {{
      html[data-theme-desktop="system"] {{ --launch-shell-title-fg: rgb(255,255,255); }}
    }}
    body {{
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: var(--font-main);
    }}
    .launch-shell {{
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: calc(100dvh - 48px);
    }}
    .launch-shell-card {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: auto;
      height: auto;
      border-radius: 0;
      background: transparent;
      border: none;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      box-shadow: none;
    }}
    @keyframes titleFadeIn {{
      0% {{ opacity: 0; }}
      100% {{ opacity: 1; }}
    }}
    .launch-shell-title {{
      color: var(--launch-shell-title-fg, var(--fg));
      font-family: "Snell Roundhand", "Apple Chancery", cursive;
      font-size: 30px;
      font-weight: 200;
      letter-spacing: -0.04em;
      line-height: 1;
      white-space: nowrap;
      opacity: 0;
      animation: titleFadeIn 800ms ease-out forwards;
    }}
    html[data-view="mobile"] .launch-shell-title {{
      color: rgb(__TEXT_SESSION_MOBILE_DARK_CHANNELS__);
      font-size: 26px;
      font-weight: 900;
      padding: 0 12px;
    }}
    html[data-view="mobile"][data-theme-mobile="light"] .launch-shell-title {{ color: rgb(__TEXT_SESSION_MOBILE_LIGHT_CHANNELS__); }}
    @media (prefers-color-scheme: light) {{
      html[data-view="mobile"][data-theme-mobile="system"] .launch-shell-title {{ color: rgb(__TEXT_SESSION_MOBILE_LIGHT_CHANNELS__); }}
    }}
    .launch-shell-card.is-error {{
      width: auto;
      height: auto;
      font-size: 13px;
      line-height: 1.5;
      color: var(--fg);
    }}
  </style>
</head>
<body>
  <div class="launch-shell">
    {_HUB_LAUNCH_SHELL_BODY_HTML}
  </div>
  <script>
    (() => {{
      const params = new URLSearchParams(window.location.search || "");
      const shellPath = "/hub-launch-shell.html";
      const requestedRestart = params.get("restart") === "1";
      let restartRequested = false;
      const requestHubRestart = async () => {{
        if (!requestedRestart || restartRequested) return true;
        restartRequested = true;
        try {{
          const res = await fetch("/restart-hub", {{ method: "POST" }});
          return res.ok;
        }} catch (_err) {{
          return false;
        }}
      }};
      const ensureLaunchShellFlag = (rawTarget) => {{
        try {{
          const next = new URL(rawTarget || "/", window.location.origin);
          if (next.pathname === shellPath) return "/";
          if (!next.searchParams.has("launch_shell")) next.searchParams.set("launch_shell", "1");
          return next.pathname + next.search + next.hash;
        }} catch (_err) {{
          return "/?launch_shell=1";
        }}
      }};
      const requestedTarget = (params.get("target") || "").trim();
      const current = window.location.pathname + window.location.search + window.location.hash;
      let target = "/";
      if (requestedTarget) {{
        try {{
          const next = new URL(requestedTarget, window.location.origin);
          if (next.origin === window.location.origin && next.pathname !== shellPath) {{
            target = next.pathname + next.search + next.hash;
          }}
        }} catch (_err) {{}}
      }} else if (window.location.pathname !== shellPath) {{
        target = current;
      }}
      target = ensureLaunchShellFlag(target);
      const adoptTargetUrl = () => {{
        try {{
          window.history.replaceState(window.history.state, "", target);
          return true;
        }} catch (_err) {{
          try {{
            window.location.replace(target);
          }} catch (_replaceErr) {{
            window.location.href = target;
          }}
          return false;
        }}
      }};
      const launchShellCard = document.getElementById("launchShellCard");
      const showLaunchShellError = (message) => {{
        if (!launchShellCard) return;
        launchShellCard.classList.add("is-error");
        launchShellCard.textContent = String(message || "Hub is not responding.");
      }};
      const attemptLoad = async () => {{
        const response = await fetch(target, {{ cache: "no-store" }});
        if (!response.ok) throw new Error(`load failed: ${{response.status}}`);
        const html = await response.text();
        if (!adoptTargetUrl()) return;
        document.open();
        document.write(html);
        document.close();
      }};
      const load = async () => {{
        if (requestedRestart) {{
          const restarted = await requestHubRestart();
          if (!restarted) {{
            showLaunchShellError("restart failed");
            return;
          }}
        }}
        try {{
          await attemptLoad();
        }} catch (_err) {{
          showLaunchShellError();
        }}
      }};
      load();
    }})();
  </script>
</body>
</html>"""

_HUB_DESKTOP_TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "web" / "hub" / "desktop"
_HUB_MOBILE_TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "web" / "hub" / "mobile"
_hub_pages = _build_hub_html_pages_impl(
    desktop_template_dir=_HUB_DESKTOP_TEMPLATE_DIR,
    mobile_template_dir=_HUB_MOBILE_TEMPLATE_DIR,
    pwa_hub_manifest_url=f"/hub.webmanifest?v={Path(__file__).stat().st_mtime_ns}",
    pwa_icon_192_url="/pwa-icon-192.png",
    pwa_apple_touch_icon_url="/apple-touch-icon.png",
    hub_header_css=_PAGE_HEADER_CSS,
    hub_header_html=_PAGE_HEADER_HTML,
    hub_header_html_mobile=_PAGE_HEADER_HTML_MOBILE,
    hub_header_js=_PAGE_HEADER_JS,
)
HUB_HOME_DESKTOP_HTML = _hub_pages["hub_home_html_desktop"]
HUB_HOME_MOBILE_HTML = _hub_pages["hub_home_html_mobile"]


def _hub_action_context() -> dict[str, object]:
    return {
        "hub": hub,
        "error_page_fn": error_page,
        "format_chat_url_fn": format_chat_url,
        "queue_hub_restart_fn": queue_hub_restart,
        "release_restart_hold_fn": release_restart_hold,
    }


_GET_ROUTE_HANDLERS = {
    "/hub.webmanifest": "_get_hub_manifest",
    "/hub-launch-shell.html": "_get_hub_launch_shell",
    "/sessions": "_get_sessions",
    "/session-messages-events": "_get_session_messages_events",
    "/open-session": _get_open_session_action,
    "/revive-session": _get_revive_session_action,
    "/kill-session": _get_kill_session_action,
    "/delete-archived-session": _get_delete_archived_session_action,
    "/session-workspace": _get_session_workspace_action,
    "/": "_get_home",
    "/index.html": "_get_home",
}

_POST_ROUTE_HANDLERS = {
    "/restart-hub": _post_restart_hub_action,
    "/rename-session": _post_rename_session_action,
    "/change-session-workspace": _post_change_session_workspace_action,
    "/reset-session-agents": _post_reset_session_agents_action,
    "/pick-workspace": _post_pick_workspace_action,
    "/start-session-draft": _post_start_session_draft_action,
    "/session-messages-changed": "_post_session_messages_changed",
}

class Handler(BaseHTTPRequestHandler):
    _GET_ROUTE_HANDLERS = _GET_ROUTE_HANDLERS
    _POST_ROUTE_HANDLERS = _POST_ROUTE_HANDLERS

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, status, page):
        body = page.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_unhealthy(self, fmt, detail):
        msg = f"tmux is currently unresponsive ({detail}). Please wait a few seconds."
        if fmt == "json":
            self._send_json(503, {"ok": False, "error": msg})
        else:
            self._send_html(503, error_page(msg))

    def _read_form(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        return {key: values[-1] for key, values in parse_qs(raw).items() if values}

    def _redirect(self, location: str):
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def _dispatch_route(self, parsed, route_map: dict[str, str]) -> bool:
        handler_name = route_map.get(parsed.path)
        if not handler_name:
            return False
        if callable(handler_name):
            handler_name(self, parsed, _hub_action_context())
            return True
        getattr(self, handler_name)(parsed)
        return True

    def _get_hub_manifest(self, _parsed):
        palette = resolve_theme_palette()
        bg = str(palette["dark_bg"])
        body = json.dumps({
            "name": APP_DISPLAY_NAME,
            "short_name": APP_DISPLAY_NAME,
            "display": "standalone",
            "background_color": bg,
            "theme_color": bg,
            "start_url": "/hub-launch-shell.html?target=%2F%3Flaunch_shell%3D1",
            "scope": "/",
            "icons": pwa_icon_entries(),
        }, ensure_ascii=True).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/manifest+json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _get_hub_launch_shell(self, _parsed):
        variant = request_view_variant(headers=self.headers, query_string=_parsed.query)
        page = (
            HUB_LAUNCH_SHELL_HTML
            .replace("__THEME_DESKTOP__", DESKTOP_THEME_DEFAULT)
            .replace("__THEME_MOBILE__", MOBILE_THEME_DEFAULT)
            .replace("__VIEW_VARIANT__", variant)
        )
        page = page.replace(
            "__SYSTEM_LIGHT_FG__",
            str(resolve_theme_palette("light")["light_fg"]),
        )
        page = apply_font_tokens(page)
        self._send_html(200, apply_color_tokens(page))

    def _get_sessions(self, _parsed):
        live = live_sessions_query(hub)
        active = [
            {
                "name": record["name"],
                "latest_message_sender": record["latest_message_sender"],
                "latest_message_preview": record["latest_message_preview"],
                "latest_message_revision": record["latest_message_revision"],
            }
            for record in active_session_records(live)
        ]
        archived = [
            {
                "name": record["name"],
                "latest_message_sender": record["latest_message_sender"],
                "latest_message_preview": record["latest_message_preview"],
                "latest_message_revision": record["latest_message_revision"],
                "has_agents": bool(record["agents"]),
            }
            for record in archived_session_records(live)
        ]
        self._send_json(200, {
            "hub_instance": hub.instance,
            "active_sessions": active,
            "archived_sessions": archived,
            "tmux_state": live.state,
            "tmux_detail": live.detail,
        })

    def _get_session_messages_events(self, _parsed):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        after_seq = 0
        try:
            while True:
                seq = hub.wait_for_session_messages_changed(after_seq, timeout=15.0)
                if seq is None:
                    self.wfile.write(b": keepalive\n\n")
                else:
                    after_seq = seq
                    self.wfile.write(f"event: messages\ndata: {seq}\n\n".encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return

    def _post_session_messages_changed(self, _parsed):
        hub.publish_session_messages_changed()
        self.send_response(204)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()



    def _get_home(self, _parsed):
        variant = request_view_variant(headers=self.headers, query_string=_parsed.query)
        page = HUB_HOME_MOBILE_HTML if variant == "mobile" else HUB_HOME_DESKTOP_HTML
        if variant == "desktop":
            page = page.replace("__THEME_DESKTOP__", DESKTOP_THEME_DEFAULT)
            page = page.replace("__TEXT_SIZE_PX__", f"{DESKTOP_TEXT_SIZE}px")
            page = page.replace("__TEXT_SIZE_DEFAULT__", str(DESKTOP_TEXT_SIZE))
            page = page.replace("__TEXT_SIZE_MIN__", str(TEXT_SIZE_MIN))
            page = page.replace("__TEXT_SIZE_MAX__", str(TEXT_SIZE_MAX))
        page = apply_font_tokens(page.replace("__HUB_INSTANCE__", hub.instance))
        self._send_html(
            200,
            apply_color_tokens(page, mobile_theme_default=MOBILE_THEME_DEFAULT),
        )






    def do_GET(self):
        parsed = urlparse(self.path)
        if split_chat_proxy_path(parsed.path) is not None:
            proxy_chat_session(self, "GET")
            return
        if serve_pwa_file(self, parsed.path, _HUB_PWA_FILES):
            return
        if self._dispatch_route(parsed, self._GET_ROUTE_HANDLERS):
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if split_chat_proxy_path(parsed.path) is not None:
            proxy_chat_session(self, "POST")
            return
        if self._dispatch_route(parsed, self._POST_ROUTE_HANDLERS):
            return
        self.send_response(404)
        self.end_headers()


def main(argv: list[str] | None = None) -> None:
    global hub_server

    initialize_from_argv(argv)

    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer.request_queue_size = 128
    hub_server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"http://127.0.0.1:{port}/", flush=True)
    hub_server.serve_forever()
    if restart_pending:
        _restart_release_event.wait()


if __name__ == "__main__":
    main()
