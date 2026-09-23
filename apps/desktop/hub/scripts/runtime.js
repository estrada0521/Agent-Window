    function isTauriDesktopApp() {
      return document.documentElement.dataset.tauriApp === "1";
    }
    function getTauriInvoke() {
      return window.__TAURI__?.core?.invoke;
    }
    const PHONE_VIEWPORT_MAX_PX = 480;
    const _deskWorkbench = document.getElementById("deskWorkbench");
    const _deskSidebar = document.getElementById("deskSidebar");
    const _deskSidebarResizer = document.getElementById("deskSidebarResizer");
    const _deskAppSidebarToggle = document.getElementById("deskAppSidebarToggle");
    const _deskSessionList = document.getElementById("deskSessionList");
    const _deskChatFrame = document.getElementById("deskChatFrame");
    const _deskChatMenuBtn = document.getElementById("deskChatMenuBtn");
    const _deskChatReloadBtn = document.getElementById("deskChatReloadBtn");
    const _deskPanelToggle = document.getElementById("deskPanelToggle");
    const _deskChatShell = document.querySelector(".desk-chat-shell");
    const _deskReloadShell = document.getElementById("deskReloadShell");
    const _deskMain = document.querySelector(".desk-main");
    const _deskSettingsBtn = document.getElementById("deskSettingsBtn");
    const _deskThemeToggleBtn = document.getElementById("deskThemeToggleBtn");
    const _deskReloadBtn = document.getElementById("deskReloadBtn");
    const _deskNewSessionToggle = document.getElementById("deskNewSessionToggle");
    const _deskHubMessage = document.getElementById("deskHubMessage");
    const _deskFloatingControls = document.querySelector(".desk-floating-controls");
    const _deskTopRightControls = document.querySelector(".desk-top-right-controls");
    const _deskWindowTraffic = document.querySelector(".desk-window-traffic");
    const _deskSessionTitleTextEl = document.getElementById("deskSessionTitleText");
    const DESK_SELECTED_KEY = "agent_window_hub_selected_session";
    const DESK_SIDEBAR_WIDTH_KEY = "agent_window_hub_sidebar_width_at_default_text_size";
    const DESK_SIDEBAR_OPEN_KEY = "agent_window_hub_sidebar_open";
    const DESK_AUTO_HEIGHT_KEY = "agent_window_hub_auto_window_height";
    const HUB_PENDING_ERROR_KEY = "agent_window_hub_pending_error";
    const DESK_DEFAULT_SIDEBAR_WIDTH_AT_DEFAULT_TEXT_SIZE = 262;
    const DESK_MIN_SIDEBAR_WIDTH_AT_DEFAULT_TEXT_SIZE = 160;
    const DESK_MAX_SIDEBAR_WIDTH_AT_DEFAULT_TEXT_SIZE = 420;
    const DESK_SWIPE_ACTION_WIDTH = 92;
    const DESK_SWIPE_OPEN_THRESHOLD = 40;
    const DESK_SIDEBAR_CLOSE_SWIPE_EDGE_PX = 36;
    const DESK_SIDEBAR_CLOSE_SWIPE_THRESHOLD = 54;
    const DESK_CHAT_URL_CACHE_LIMIT = 3;
    const DESK_HUB_MESSAGE_VISIBLE_MS = 5000;
    const hubChatUrls = createHubChatUrlResolver({
      cacheLimit: DESK_CHAT_URL_CACHE_LIMIT,
      cacheKey: (openHref) => String(openHref || "").trim(),
      wrapUrl: (url) => String(url || "").trim(),
      errorMessage: "chat url unavailable",
    });
    let _deskPanelActiveMode = "";
    let _deskPanelWidth = 0;
    let _deskOutwardResizeInFlight = false;
    const _phoneViewportQuery = window.matchMedia(`(max-width: ${PHONE_VIEWPORT_MAX_PX}px)`);
    const esc = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
    const cssEsc = (value) => {
      const normalized = String(value || "");
      try {
        return window.CSS && typeof window.CSS.escape === "function"
          ? window.CSS.escape(normalized)
          : normalized.replace(/["\\]/g, "\\$&");
      } catch (_) {
        return normalized.replace(/["\\]/g, "\\$&");
      }
    };

    const _deskAppearance = window.__agentWindowAppearance;
    const DESK_THEME_KEY = _deskAppearance.themeKey;
    const DESK_TEXT_SIZE_KEY = _deskAppearance.textSizeKey;
    const DESK_TEXT_SIZE_MIN = _deskAppearance.textSizeMin;
    const DESK_TEXT_SIZE_MAX = _deskAppearance.textSizeMax;
    const DESK_TEXT_SIZE_DEFAULT = _deskAppearance.textSizeDefault;
    function currentDeskTextSizePx() {
      const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-size"));
      return Number.isFinite(raw) ? raw : DESK_TEXT_SIZE_DEFAULT;
    }
    function clampDeskTextSize(px) {
      return Math.max(DESK_TEXT_SIZE_MIN, Math.min(DESK_TEXT_SIZE_MAX, Math.round(px)));
    }
    function applyDeskTextSizeLocal(px) {
      const clamped = clampDeskTextSize(px);
      document.documentElement.style.setProperty("--text-size", `${clamped}px`);
      return clamped;
    }
    function applyDeskTextSizeAndBroadcast(px) {
      const previous = currentDeskTextSizePx();
      const clamped = clampDeskTextSize(px);
      const invoke = getTauriInvoke();
      const scalesWindow = clamped !== previous && typeof invoke === "function";
      applyDeskTextSizeLocal(clamped);
      applyDeskSidebarWidth();
      updateDeskChromeOverflow();
      localStorage.setItem(DESK_TEXT_SIZE_KEY, String(clamped));
      _deskChatFrame?.contentWindow?.postMessage({ type: "hub-text-size-changed", textSize: clamped }, "*");
      if (scalesWindow) {
        _deskLastFitTarget *= clamped / previous;
        invoke("scale_window_from_top_center", { scale: clamped / previous, cornerRadius: clamped * 2 }).catch((err) => {
          showDeskHubMessage(`window zoom resize failed: ${err}`, { error: true });
        });
      }
    }
    function dispatchDeskNativeMenuAction(payload) {
      _deskChatFrame?.contentWindow?.postMessage({ type: "native-menu-action", payload }, "*");
    }
    function resetDeskChatView() {
      _deskChatFrame?.contentWindow?.postMessage({ type: "desktop-chat-reset" }, "*");
    }
