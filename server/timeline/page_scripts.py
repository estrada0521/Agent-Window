from __future__ import annotations

from tmux.key_macro import PANE_TEXT_MACROS, PANE_FUNCTION_KEYS


_PANE_TEXT_MACRO_OPTIONS_HTML = "\n".join(
    f'          <option value="{macro}">{macro}</option>' for macro in PANE_TEXT_MACROS
)

TIMELINE_HEADER_MENU_BUTTON_HTML = """
<button type="button" class="page-menu-btn" id="pageMenuBtn" title="Menu" aria-label="Menu">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="10" y1="15" x2="20" y2="15"/></svg>
</button>
"""
TIMELINE_SHEET_PANELS_HTML = f"""
<div class="page-menu-panel mobile-sheet-overlay" id="mobileSheet" hidden></div>
<div class="page-menu-panel mobile-sheet-overlay" id="paneTracePanel" hidden>
  <div class="hub-main-menu-stack">
    <div id="paneViewer" class="pane-viewer" hidden>
      <div class="git-commit-detail-body pane-viewer-detail-body">
        <div class="pane-viewer-tabs" id="paneViewerTabs"></div>
        <div class="pane-viewer-carousel" id="paneViewerCarousel"></div>
      </div>
      <div class="pane-viewer-keys" id="paneViewerKeys">
        <select id="paneViewerMacroSelect" class="pane-viewer-key-native-select" aria-label="Command" tabindex="-1">
          <option value="" disabled selected>Command</option>
{_PANE_TEXT_MACRO_OPTIONS_HTML}
        </select>
        <button type="button" class="pane-viewer-key-btn pane-viewer-key-btn-text" data-key-macro="esc" aria-label="Escape">Esc</button>
        <button type="button" class="pane-viewer-key-btn pane-viewer-key-btn-text" data-key-macro="ctrlc" aria-label="Ctrl+C">^C</button>
        <button type="button" id="paneViewerFunctionBtn" class="pane-viewer-key-btn pane-viewer-key-btn-text" aria-label="Function keys">F</button>
        <select id="paneViewerFunctionSelect" class="pane-viewer-key-native-select" aria-label="Function keys" tabindex="-1">
          <option value="" disabled selected>Function keys</option>
{''.join(f'<option value="{key.lower()}">{key}</option>' for key in PANE_FUNCTION_KEYS)}
        </select>
        <button type="button" class="pane-viewer-key-btn" data-key-macro="up" aria-label="Up">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>
        </button>
        <button type="button" class="pane-viewer-key-btn" data-key-macro="down" aria-label="Down">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 13 12 19 6 13"/></svg>
        </button>
        <button type="button" class="pane-viewer-key-btn" data-key-macro="left" aria-label="Left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="11 6 5 12 11 18"/></svg>
        </button>
        <button type="button" class="pane-viewer-key-btn" data-key-macro="right" aria-label="Right">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
        </button>
        <button type="button" class="pane-viewer-key-btn" data-key-macro="enter" aria-label="Enter">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>
        </button>
      </div>
    </div>
  </div>
</div>
"""
