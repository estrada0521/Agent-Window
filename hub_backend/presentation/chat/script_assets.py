from __future__ import annotations


MARKED_VERSION = "18.0.12"
KATEX_VERSION = "0.16.11"

MARKED_CDN_SRC = f"https://cdn.jsdelivr.net/npm/marked@{MARKED_VERSION}/lib/marked.umd.min.js"
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
  <option value="openShell">Terminal</option>
  <option value="openTerminal">tmux window</option>
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
      <div class="pane-viewer-shortcuts" id="paneViewerShortcuts">
        <button type="button" class="pane-viewer-shortcut-btn" data-shortcut="up" aria-label="Up">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>
        </button>
        <button type="button" class="pane-viewer-shortcut-btn" data-shortcut="down" aria-label="Down">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 13 12 19 6 13"/></svg>
        </button>
        <button type="button" class="pane-viewer-shortcut-btn" data-shortcut="left" aria-label="Left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="11 6 5 12 11 18"/></svg>
        </button>
        <button type="button" class="pane-viewer-shortcut-btn" data-shortcut="right" aria-label="Right">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
        </button>
        <button type="button" class="pane-viewer-shortcut-btn" data-shortcut="enter" aria-label="Enter">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>
        </button>
        <button type="button" class="pane-viewer-shortcut-btn pane-viewer-shortcut-btn-text" data-shortcut="esc" aria-label="Escape">Esc</button>
        <button type="button" class="pane-viewer-shortcut-btn pane-viewer-shortcut-btn-text" data-shortcut="ctrlc" aria-label="Ctrl+C">^C</button>
      </div>
    </div>
  </div>
</div>
"""
