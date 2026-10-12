from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from server.same_origin import reject_cross_origin
from server.hub.state import HubState
from server.appearance.colors import apply_color_tokens, resolve_theme_palette
from server.appearance.colors import DESKTOP_THEME_DEFAULT, MOBILE_THEME_DEFAULT
from server.appearance.typography import DESKTOP_TEXT_SIZE, TEXT_SIZE_MAX, TEXT_SIZE_MIN, apply_font_tokens
from server.pwa import PWA_FILES, pwa_icon_entries, serve_pwa_file
from server.hub.timeline_routes import dispatch_timeline_route
from server.page_header import (
    PAGE_HEADER_CSS,
    PAGE_HEADER_JS,
    MOBILE_HUB_HEADER_ACTIONS,
    render_page_header,
)
from server.hub.timeline_query import (
    active_timeline_records,
    archived_timeline_records,
    live_timelines_query,
)

from server import APP_DISPLAY_NAME
from server.hub.new_timeline import (
    post_pick_workspace,
    post_start_timeline_draft,
)
from server.hub.actions import (
    post_delete_archived_timeline,
    post_archive_timeline,
    post_open_timeline,
    post_revive_timeline,
    get_timeline_workspace,
    get_timeline_stats,
    post_change_timeline_workspace,
    post_rename_timeline,
    post_reset_timeline_agents,
    post_restart_hub,
)
from server.hub.pages import build_hub_html_pages, error_page
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
RELOAD_RUNNING_AGENTS_ENV = "AGENT_WINDOW_RELOAD_RUNNING_AGENTS"


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
    port = int((repo_root / "server" / "hub" / "port").read_text().strip())
    hub = HubState(initial_running_agents=json.loads(os.environ.pop(RELOAD_RUNNING_AGENTS_ENV, "{}")))
    restart_pending, hub_server = False, None

    _initialized = True


PROCESS_HANDOFF_TIMEOUT_SEC = 8.0


def _restart_env():
    return {**os.environ, RELOAD_RUNNING_AGENTS_ENV: json.dumps(hub.running_agents_for_reload())}


def launch_hub_restart(*, script_path, repo_root, hub_server) -> str:
    hub_server.shutdown()
    hub_server.server_close()
    hub.close()
    try:
        completed = subprocess.run(
            ["bash", str(script_path)],
            cwd=repo_root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            check=False,
            timeout=PROCESS_HANDOFF_TIMEOUT_SEC,
            env=_restart_env(),
        )
    except subprocess.TimeoutExpired:
        return f"server/hub/start did not finish within {PROCESS_HANDOFF_TIMEOUT_SEC:g}s"
    return "" if completed.returncode == 0 else completed.stderr.strip() or f"server/hub/start exited {completed.returncode}"


def queue_hub_restart():
    global restart_pending
    with restart_lock:
        if restart_pending:
            return False, "restart already pending", False
        restart_pending = True
    detail = launch_hub_restart(script_path=script_path, repo_root=repo_root, hub_server=hub_server)
    return not detail, detail, True


def release_restart_hold():
    _restart_release_event.set()

_HUB_PWA_FILES = {
    **PWA_FILES,
    "/hub-service-worker.js": ("service-worker.js", "application/javascript; charset=utf-8"),
}

_HUB_LAUNCH_SHELL_BODY_HTML = (
    '<div class="launch-shell-card">'
    '<span class="launch-shell-title">Agent Window</span>'
    "</div>"
)
_HUB_LAUNCH_SHELL_CSS = (Path(__file__).resolve().parents[2] / "web" / "hub" / "launch-shell.css").read_text()
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
      const storedSize = localStorage.getItem("agent_window_text_size");
      const size = storedSize === null
        ? __TEXT_SIZE_DEFAULT__
        : Math.max(__TEXT_SIZE_MIN__, Math.min(__TEXT_SIZE_MAX__, Math.round(Number(storedSize))));
      document.documentElement.style.setProperty("--text-size", `${{size}}px`);
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
    body {{ font-family: var(--font-main); }}
    {_HUB_LAUNCH_SHELL_CSS}
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
      const showLaunchShellError = (message) => {{
        const handler = window.webkit?.messageHandlers?.agentWindow;
        if (handler) {{
          return handler.postMessage({{ cmd: "show_hub_error", args: {{ message }} }});
        }}
        document.body.style.cssText = "box-sizing:border-box;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:40px;font:13px ui-monospace,monospace;white-space:pre-wrap;overflow:auto";
        document.body.textContent = message;
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
            await showLaunchShellError("Hub failed to restart.");
            return;
          }}
        }}
        try {{
          await attemptLoad();
        }} catch (_err) {{
          await showLaunchShellError("Hub is not responding.");
        }}
      }};
      load();
    }})();
  </script>
</body>
</html>"""

_HUB_DESKTOP_TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "web" / "hub" / "desktop"
_HUB_MOBILE_TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "web" / "hub" / "mobile"
_hub_pages = build_hub_html_pages(
    desktop_template_dir=_HUB_DESKTOP_TEMPLATE_DIR,
    mobile_template_dir=_HUB_MOBILE_TEMPLATE_DIR,
    pwa_hub_manifest_url=f"/hub.webmanifest?v={Path(__file__).stat().st_mtime_ns}",
    pwa_icon_192_url="/pwa-icon-192.png",
    pwa_apple_touch_icon_url="/apple-touch-icon.png",
    hub_header_css=PAGE_HEADER_CSS,
    hub_header_html=render_page_header(),
    hub_header_html_mobile=render_page_header(actions_html=MOBILE_HUB_HEADER_ACTIONS),
    hub_header_js=PAGE_HEADER_JS,
)
HUB_HOME_DESKTOP_HTML = _hub_pages["hub_home_html_desktop"]
HUB_HOME_MOBILE_HTML = _hub_pages["hub_home_html_mobile"]


def _hub_action_context() -> dict[str, object]:
    return {
        "hub": hub,
        "queue_hub_restart_fn": queue_hub_restart,
        "release_restart_hold_fn": release_restart_hold,
    }


class Handler(BaseHTTPRequestHandler):
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
        self.log_error("tmux unresponsive: %s", detail)
        msg = "tmux is unresponsive"
        if fmt == "json":
            self._send_json(503, {"ok": False, "error": msg})
        else:
            self._send_html(503, error_page(msg))

    def _read_form(self):
        length = int(self.headers["Content-Length"])
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        return {key: values[-1] for key, values in parse_qs(raw).items() if values}

    def _redirect(self, location: str):
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def _dispatch_route(self, parsed, route_map) -> bool:
        route = route_map.get(parsed.path)
        if route is None:
            return False
        try:
            route(self, parsed, _hub_action_context())
        except Exception as exc:
            self.log_error("Hub request failed: %s: %s", type(exc).__name__, exc)
            self._send_json(500, {"ok": False, "error": "Hub request failed"})
        return True

    def _get_hub_manifest(self, _parsed, _ctx):
        palette = resolve_theme_palette()
        bg = str(palette["dark_bg"])
        body = json.dumps({
            "name": APP_DISPLAY_NAME,
            "short_name": APP_DISPLAY_NAME,
            "display": "standalone",
            "background_color": bg,
            "theme_color": bg,
            "start_url": "/?launch_shell=1",
            "scope": "/",
            "icons": pwa_icon_entries(),
        }, ensure_ascii=True).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/manifest+json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _get_hub_launch_shell(self, _parsed, _ctx):
        variant = request_view_variant(headers=self.headers, query_string=_parsed.query)
        if variant == "mobile":
            self._get_home(_parsed, _ctx)
            return
        page = (
            HUB_LAUNCH_SHELL_HTML
            .replace("__THEME_DESKTOP__", DESKTOP_THEME_DEFAULT)
            .replace("__THEME_MOBILE__", MOBILE_THEME_DEFAULT)
            .replace("__VIEW_VARIANT__", variant)
            .replace("__TEXT_SIZE_DEFAULT__", str(DESKTOP_TEXT_SIZE))
            .replace("__TEXT_SIZE_MIN__", str(TEXT_SIZE_MIN))
            .replace("__TEXT_SIZE_MAX__", str(TEXT_SIZE_MAX))
        )
        page = page.replace(
            "__SYSTEM_LIGHT_FG__",
            str(resolve_theme_palette("light")["light_fg"]),
        )
        page = apply_font_tokens(page)
        self._send_html(200, apply_color_tokens(page))

    def _get_timelines(self, _parsed, _ctx):
        live = live_timelines_query(hub)
        self._send_json(200, {
            "server_instance": hub.server_instance,
            "active_timelines": active_timeline_records(live),
            "archived_timelines": archived_timeline_records(live),
            "tmux_state": live.state,
            "tmux_detail": live.detail,
        })

    def _get_timeline_messages_events(self, _parsed, _ctx):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        after_seq = 0
        try:
            while True:
                seq = hub.wait_for_timeline_messages_changed(after_seq, timeout=15.0)
                if seq is None:
                    self.wfile.write(b": keepalive\n\n")
                else:
                    after_seq = seq
                    self.wfile.write(f"event: messages\ndata: {seq}\n\n".encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return

    def _get_home(self, _parsed, _ctx):
        variant = request_view_variant(headers=self.headers, query_string=_parsed.query)
        page = HUB_HOME_MOBILE_HTML if variant == "mobile" else HUB_HOME_DESKTOP_HTML
        if variant == "desktop":
            page = page.replace("__THEME_DESKTOP__", DESKTOP_THEME_DEFAULT)
            page = page.replace("__TEXT_SIZE_PX__", f"{DESKTOP_TEXT_SIZE}px")
            page = page.replace("__TEXT_SIZE_DEFAULT__", str(DESKTOP_TEXT_SIZE))
            page = page.replace("__TEXT_SIZE_MIN__", str(TEXT_SIZE_MIN))
            page = page.replace("__TEXT_SIZE_MAX__", str(TEXT_SIZE_MAX))
        page = apply_font_tokens(page.replace("__SERVER_INSTANCE__", hub.server_instance))
        self._send_html(
            200,
            apply_color_tokens(page, mobile_theme_default=MOBILE_THEME_DEFAULT),
        )






    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if dispatch_timeline_route(self, "GET", parsed, hub):
                return
        except Exception as exc:
            self.log_error("Timeline request failed: %s", exc)
            self._send_json(500, {"ok": False, "error": "Timeline request failed"})
            return
        if serve_pwa_file(self, parsed.path, _HUB_PWA_FILES):
            return
        if self._dispatch_route(parsed, _GET_ROUTE_HANDLERS):
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if reject_cross_origin(self):
            return
        parsed = urlparse(self.path)
        try:
            if dispatch_timeline_route(self, "POST", parsed, hub):
                return
        except Exception as exc:
            self.log_error("Timeline request failed: %s", exc)
            self._send_json(500, {"ok": False, "error": "Timeline request failed"})
            return
        if self._dispatch_route(parsed, _POST_ROUTE_HANDLERS):
            return
        self.send_response(404)
        self.end_headers()


_GET_ROUTE_HANDLERS = {
    "/hub.webmanifest": Handler._get_hub_manifest,
    "/hub-launch-shell.html": Handler._get_hub_launch_shell,
    "/timelines": Handler._get_timelines,
    "/timeline-messages-events": Handler._get_timeline_messages_events,
    "/timeline-workspace": get_timeline_workspace,
    "/timeline-stats": get_timeline_stats,
    "/": Handler._get_home,
    "/index.html": Handler._get_home,
}

_POST_ROUTE_HANDLERS = {
    "/open-timeline": post_open_timeline,
    "/revive-timeline": post_revive_timeline,
    "/archive-timeline": post_archive_timeline,
    "/delete-archived-timeline": post_delete_archived_timeline,
    "/restart-hub": post_restart_hub,
    "/rename-timeline": post_rename_timeline,
    "/change-timeline-workspace": post_change_timeline_workspace,
    "/reset-timeline-agents": post_reset_timeline_agents,
    "/pick-workspace": post_pick_workspace,
    "/start-timeline-draft": post_start_timeline_draft,
}


def main(argv: list[str] | None = None) -> None:
    global hub_server

    initialize_from_argv(argv)

    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer.request_queue_size = 128
    hub_server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=hub.start_timelines, daemon=True, name="timeline-startup").start()
    print(f"http://127.0.0.1:{port}/", flush=True)
    hub_server.serve_forever()
    if restart_pending:
        _restart_release_event.wait()


if __name__ == "__main__":
    main()
