from __future__ import annotations

import hashlib
from dataclasses import dataclass


ANSI_UP_VERSION = "5.1.0"
MARKED_VERSION = "12"
KATEX_VERSION = "0.16.11"

ANSI_UP_CDN_SRC = f"https://cdn.jsdelivr.net/npm/ansi_up@{ANSI_UP_VERSION}/ansi_up.min.js"
MARKED_CDN_SRC = f"https://cdn.jsdelivr.net/npm/marked@{MARKED_VERSION}/marked.min.js"
KATEX_CDN_CSS_HREF = f"https://cdn.jsdelivr.net/npm/katex@{KATEX_VERSION}/dist/katex.min.css"
KATEX_CDN_JS_SRC = f"https://cdn.jsdelivr.net/npm/katex@{KATEX_VERSION}/dist/katex.min.js"
KATEX_CDN_AUTO_RENDER_SRC = f"https://cdn.jsdelivr.net/npm/katex@{KATEX_VERSION}/dist/contrib/auto-render.min.js"

CHAT_HEADER_MENU_BUTTON_HTML = """
<button type="button" class="page-menu-btn" id="pageMenuBtn" title="Menu" aria-label="Menu">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="10" y1="15" x2="20" y2="15"/></svg>
</button>
"""
CHAT_HEADER_ACTIONS_HTML_MOBILE = CHAT_HEADER_MENU_BUTTON_HTML
CHAT_HEADER_ACTIONS_HTML = CHAT_HEADER_MENU_BUTTON_HTML + """
<select id="pageNativeMenuBridge" style="position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0.001;pointer-events:auto;appearance:none;-webkit-appearance:none;border:none;outline:none;background:transparent;font-size:13px;z-index:220;cursor:pointer;-webkit-tap-highlight-color:transparent;" aria-hidden="true">
  <option value="" disabled selected>Menu</option>
  <option value="openTerminal">Terminal</option>
  <option value="openFinder">Finder</option>
  <option value="addAgent">Add Agent</option>
  <option value="removeAgent">Remove Agent</option>
</select>
"""
CHAT_SHEET_PANELS_HTML = """
<div class="page-menu-panel mobile-sheet-overlay" id="gitPanel" hidden></div>
<div class="page-menu-panel mobile-sheet-overlay" id="repoPanel" hidden></div>
<div class="page-menu-panel mobile-sheet-overlay" id="paneTracePanel" hidden>
  <div class="hub-main-menu-stack">
    <div id="paneViewer" class="pane-viewer" hidden>
      <div class="git-commit-detail-body pane-viewer-detail-body">
        <div class="pane-viewer-tabs" id="paneViewerTabs"></div>
        <div class="pane-viewer-carousel" id="paneViewerCarousel"></div>
      </div>
    </div>
  </div>
</div>
"""
CHAT_ANSI_UP_HEAD_TAG = f'  <script src="{ANSI_UP_CDN_SRC}"></script>\n'
CHAT_KATEX_HEAD_TAGS = (
    f'  <link rel="stylesheet" href="{KATEX_CDN_CSS_HREF}">\n'
    f'  <script src="{KATEX_CDN_JS_SRC}"></script>\n'
    f'  <script src="{KATEX_CDN_AUTO_RENDER_SRC}"></script>\n'
)


@dataclass(frozen=True)
class ChatAppScriptAssets:
    block: str
    template: str
    asset: str
    version: str


def build_chat_app_script_assets(chat_html: str) -> ChatAppScriptAssets:
    script_open = "  <script>\n"
    script_close = "  </script>\n"
    script_start = chat_html.rfind(script_open)
    if script_start < 0:
        raise ValueError("chat app script block not found")
    script_end = chat_html.find(script_close, script_start)
    if script_end < 0:
        raise ValueError("chat app script close tag not found")
    block = chat_html[script_start:script_end + len(script_close)]
    template = chat_html[script_start + len(script_open):script_end]
    asset = (
        template
        .replace(
            '    const CHAT_BASE_PATH = "__CHAT_BASE_PATH__";\n',
            '    const CHAT_BOOTSTRAP = window.__CHAT_BOOTSTRAP__ || {};\n'
            '    const CHAT_BASE_PATH = String(CHAT_BOOTSTRAP.basePath || "");\n',
            1,
        )
        .replace(
            '    const AGENT_ICON_NAMES = __AGENT_ICON_NAMES_JS_SET__;\n',
            '    const AGENT_ICON_NAMES = new Set(Array.isArray(CHAT_BOOTSTRAP.agentIconNames) ? CHAT_BOOTSTRAP.agentIconNames : []);\n',
            1,
        )
        .replace(
            '    const ALL_BASE_AGENTS = __ALL_BASE_AGENTS_JS_ARRAY__;\n',
            '    const ALL_BASE_AGENTS = Array.isArray(CHAT_BOOTSTRAP.allBaseAgents) ? CHAT_BOOTSTRAP.allBaseAgents : [];\n',
            1,
        )
        .replace(
            '    const AGENT_ICON_DATA = __ICON_DATA_URIS__;\n',
            '    const AGENT_ICON_DATA = CHAT_BOOTSTRAP.iconDataUris || {};\n',
            1,
        )
        .replace(
            '    const SERVER_INSTANCE_SEED = "__SERVER_INSTANCE__";\n',
            '    const SERVER_INSTANCE_SEED = String(CHAT_BOOTSTRAP.serverInstance || "");\n',
            1,
        )
        .replace(
            '      const hubUrl = `${window.location.protocol}//${hubHost}:__HUB_PORT__${normalizedPath}`;\n',
            '      const hubUrl = `${window.location.protocol}//${hubHost}:${Number(CHAT_BOOTSTRAP.hubPort) || 0}${normalizedPath}`;\n',
            1,
        )
    )
    version = hashlib.sha256(asset.encode("utf-8")).hexdigest()[:12]
    return ChatAppScriptAssets(block=block, template=template, asset=asset, version=version)
