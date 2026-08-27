    const _chatOverlay = document.getElementById("chatOverlay");
    const _chatFrame = document.getElementById("chatFrame");
    const _launchShell = document.getElementById("launchShell");
    let _hubChatParentLayoutMax = 0;
    let _hubMinParentChromeGap = Infinity;
    let _hubLayoutRefW = 0;
    let _hubLayoutRefH = 0;
    let _hubVVBridgeHandler = null;
    let _hubPreOverlayScrollY = 0;
    let _currentChatSessionName = "";
    let _currentChatUrl = "";
    let _prewarmedSessionName = "";
    let _prewarmedChatUrl = "";
    let _prewarmedFrameReady = false;
    let _prewarmedFrameRenderReady = false;
    let _prewarmToken = 0;
    let _hubLaunchShellPending = false;
    let _awaitingChatRenderReady = false;
    let _hubReadyTimeoutTimer = 0;
    let _chatOverlayCloseTimer = 0;
    let refreshMobSessions = null;
    const HUB_CHAT_FRAME_KEY = "hub_chat_frame";
    const HUB_LAST_SESSION_KEY = "agent_window_hub_last_session_name";
    const HUB_PENDING_ERROR_KEY = "agent_window_hub_pending_error";
    const HUB_CHAT_URL_CACHE_TTL_MS = 180000;
    const HUB_CHAT_URL_CACHE_LIMIT = 3;
    const HUB_ACTIVE_PREWARM_LIMIT = 3;
    const HUB_LAUNCH_SHELL_PARAM = "launch_shell";
    const hubChatUrls = createHubChatUrlResolver({
      cacheLimit: HUB_CHAT_URL_CACHE_LIMIT,
      ttlMs: HUB_CHAT_URL_CACHE_TTL_MS,
      cacheKey: (openHref, name) => String(name || "").trim() || String(openHref || "").trim(),
      wrapUrl: (url) => hubFrameChatUrl(url),
      errorMessage: "open session failed",
    });
    const applyMobThemeGradientVars = () => {
      const root = document.documentElement;
      const channels = root.dataset.theme === "light" ? "255, 255, 255" : "10, 10, 9";
      root.style.setProperty("--mob-top-gradient-rgb", channels);
    };
    applyMobThemeGradientVars();
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "data-theme")) {
        applyMobThemeGradientVars();
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const resolveMobileTheme = () => {
      try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch (_) { return "dark"; }
    };
    const publishMobileTheme = (observedTheme = "") => {
      const theme = observedTheme === "light" || observedTheme === "dark"
        ? observedTheme
        : resolveMobileTheme();
      const root = document.documentElement;
      root.dataset.theme = theme;
      // Do this synchronously as well as through the CSS selector.  Safari's
      // PWA renderer can otherwise keep the fixed Hub gradient in its old
      // compositing layer for a frame after an appearance change.
      root.style.colorScheme = theme;
      applyMobThemeGradientVars();
      try { _chatFrame.contentDocument.documentElement.dataset.theme = theme; } catch (_) {}
      try { _chatFrame?.contentWindow?.postMessage({ type: "hub-theme-changed", theme }, "*"); } catch (_) {}
      return theme;
    };
    publishMobileTheme();
    const refreshSystemMobileTheme = () => publishMobileTheme();
    try {
      const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
      if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener("change", refreshSystemMobileTheme);
      else if (systemThemeQuery.addListener) systemThemeQuery.addListener(refreshSystemMobileTheme);
    } catch (_) {}
    // iOS may defer a media-query change while an installed PWA is in the
    // background.  Reconcile on every return to the Hub, but only in System.
    window.addEventListener("pageshow", refreshSystemMobileTheme);
    window.addEventListener("focus", refreshSystemMobileTheme);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshSystemMobileTheme();
    });
    const HUB_READY_TIMEOUT_MS = 5000;
    const CHAT_OVERLAY_CLOSE_MS = 300;
    function resetChatOverlayMotionStyles() {
      _chatOverlay.style.transform = "";
      _chatOverlay.style.transition = "";
      _chatOverlay.style.opacity = "";
    }
    function showLaunchShell() {
      if (!_launchShell) return;
      _launchShell.hidden = false;
      _launchShell.classList.add("visible");
    }
    function resetLaunchShellCard() {
      const card = _launchShell?.querySelector(".launch-shell-card");
      if (!card) return;
      card.setAttribute("aria-hidden", "true");
      card.innerHTML = '<span class="launch-shell-title">Agent Window</span>';
    }
    function hideLaunchShell() {
      if (!_launchShell) return;
      _launchShell.classList.remove("visible");
      _launchShell.hidden = true;
    }
    function clearHubReadyTimeout() {
      if (!_hubReadyTimeoutTimer) return;
      clearTimeout(_hubReadyTimeoutTimer);
      _hubReadyTimeoutTimer = 0;
    }
    function failHubReadyWait(message) {
      _hubLaunchShellPending = false;
      _awaitingChatRenderReady = false;
      clearHubReadyTimeout();
      clearLaunchShellQueryFlag();
      hideLaunchShell();
    }
    function startHubReadyTimeout() {
      if (_hubReadyTimeoutTimer) return;
      resetLaunchShellCard();
      _hubReadyTimeoutTimer = setTimeout(() => {
        failHubReadyWait("timeout");
      }, HUB_READY_TIMEOUT_MS);
    }
    function finishHubReadyWaitIfComplete() {
      if (_hubLaunchShellPending || _awaitingChatRenderReady) return;
      clearHubReadyTimeout();
      hideLaunchShell();
    }
    function clearLaunchShellQueryFlag() {
      const params = new URLSearchParams(window.location.search || "");
      if (!params.has(HUB_LAUNCH_SHELL_PARAM)) return;
      params.delete(HUB_LAUNCH_SHELL_PARAM);
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash || ""}`;
      try {
        window.history.replaceState(window.history.state, "", nextUrl);
      } catch (_) { }
    }
    function releaseHubLaunchShellAfterRender() {
      if (!_hubLaunchShellPending) return;
      _hubLaunchShellPending = false;
      clearLaunchShellQueryFlag();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          finishHubReadyWaitIfComplete();
        });
      });
    }
    function startChatRenderWait() {
      _awaitingChatRenderReady = true;
      startHubReadyTimeout();
    }
    function finishChatRenderWait() {
      if (!_awaitingChatRenderReady) return;
      _awaitingChatRenderReady = false;
      finishHubReadyWaitIfComplete();
    }
    function cancelChatRenderWait() {
      _awaitingChatRenderReady = false;
      finishHubReadyWaitIfComplete();
    }
    const _launchShellParams = new URLSearchParams(window.location.search || "");
    _hubLaunchShellPending = _launchShellParams.get(HUB_LAUNCH_SHELL_PARAM) === "1";
    if (_hubLaunchShellPending) {
      showLaunchShell();
      startHubReadyTimeout();
    }
    function rememberLastSession(name) {
      const normalized = String(name || "").trim();
      if (!normalized) return;
      try { sessionStorage.setItem(HUB_LAST_SESSION_KEY, normalized); } catch (_) { }
    }
    function lastRememberedSession() {
      try { return (sessionStorage.getItem(HUB_LAST_SESSION_KEY) || "").trim(); } catch (_) { return ""; }
    }
    function syncMobileSelectedSessionRows() {
      const selectedName = String(_currentChatSessionName || lastRememberedSession() || "").trim();
      document.querySelectorAll("#mobListWrap .mob-session-row[data-session-name]").forEach((row) => {
        const isSelected = !!selectedName && row.dataset.sessionName === selectedName;
        row.classList.toggle("is-selected", isSelected);
        if (isSelected) row.setAttribute("aria-current", "page");
        else row.removeAttribute("aria-current");
      });
    }
    function persistChatFrameState(url, name) {
      const normalizedUrl = String(url || "").trim();
      if (!normalizedUrl) return;
      const normalizedName = String(name || "").trim();
      try { sessionStorage.setItem(HUB_CHAT_FRAME_KEY, JSON.stringify({ url: normalizedUrl, name: normalizedName })); } catch (_) { }
    }
    function clearPersistedChatFrameState() {
      try { sessionStorage.removeItem(HUB_CHAT_FRAME_KEY); } catch (_) { }
    }
    function consumePendingHubErrorMessage() {
      let message = "";
      try {
        message = String(sessionStorage.getItem(HUB_PENDING_ERROR_KEY) || "");
        if (message) sessionStorage.removeItem(HUB_PENDING_ERROR_KEY);
      } catch (_) {
        message = "";
      }
      return message;
    }
    function hubFrameChatUrl(chatUrl) {
      const raw = String(chatUrl || "").trim();
      if (!raw) return raw;
      try {
        const next = new URL(raw, window.location.href);
        // Direct (non-proxied) access points the iframe at the session's own
        // chat_port, a different port on this same host, not the same
        // origin as the Hub -- only reject truly foreign hosts here.
        if (next.hostname !== window.location.hostname) return raw;
        // This page only ever runs as the mobile Hub, so it already knows
        // the answer the framed chat page would otherwise have to guess
        // from headers alone -- guessing is what fails for iPad Safari.
        next.searchParams.set("view", "mobile");
        return next.origin === window.location.origin
          ? next.pathname + next.search + next.hash
          : next.toString();
      } catch (_) {}
      return raw;
    }
    function hubFrameSrcMatches(url) {
      const current = normalizeComparableUrl(_chatFrame.src);
      const next = normalizeComparableUrl(url);
      return !!current && !!next && current === next;
    }
    function cacheChatUrl(name, url) {
      hubChatUrls.write(name, url);
    }
    function setPrewarmingOverlayActive(active) {
      _chatOverlay.classList.toggle("prewarming", !!active);
      if (active) {
        _chatOverlay.classList.remove("overlay-visible", "overlay-closing");
        resetChatOverlayMotionStyles();
        _chatOverlay.hidden = false;
      } else {
        _chatOverlay.classList.remove("prewarming", "overlay-closing");
        resetChatOverlayMotionStyles();
      }
    }
    function primeChatFrame(sessionName, chatUrl) {
      const normalizedName = String(sessionName || "").trim();
      const normalizedUrl = hubFrameChatUrl(chatUrl, normalizedName);
      if (!normalizedName || !normalizedUrl) return;
      const reusingSameSrc = hubFrameSrcMatches(normalizedUrl);
      _prewarmedSessionName = normalizedName;
      _prewarmedChatUrl = normalizedUrl;
      if (!reusingSameSrc) {
        _prewarmedFrameReady = false;
        _prewarmedFrameRenderReady = false;
      }
      setPrewarmingOverlayActive(true);
      _chatFrame.onload = function () {
        _prewarmedFrameReady = true;
        publishMobileTheme();
      };
      if (!reusingSameSrc) {
        _chatFrame.style.transition = "none";
        _chatFrame.style.opacity = "0";
        _chatFrame.src = normalizedUrl;
      } else {
        _prewarmedFrameReady = true;
      }
    }
    async function resolveChatUrl(openHref, name, { force = false, prewarm = false } = {}) {
      const chatUrl = await hubChatUrls.resolve(openHref, name, { force });
      if (prewarm && chatUrl) primeChatFrame(name, chatUrl);
      return chatUrl;
    }
    function activeWarmCandidates(activeSessions) {
      return (activeSessions || [])
        .filter((session) => String(session?.name || "").trim());
    }
    function choosePrewarmSession(activeSessions) {
      const active = activeWarmCandidates(activeSessions);
      if (!active.length) return null;
      const remembered = lastRememberedSession();
      return active.find((session) => String(session?.name || "") === remembered) || active[0];
    }
    function scheduleActiveSessionPrewarm(activeSessions) {
      if (_chatOverlay && !_chatOverlay.hidden && !_chatOverlay.classList.contains("prewarming")) return;
      const token = ++_prewarmToken;
      const active = activeWarmCandidates(activeSessions).slice(0, HUB_ACTIVE_PREWARM_LIMIT);
      if (!active.length) return;
      const primary = choosePrewarmSession(active) || active[0];
      const primaryName = String(primary?.name || "").trim();
      const orderedActive = [
        primary,
        ...active.filter((session) => String(session?.name || "").trim() !== primaryName),
      ];
      orderedActive.forEach((session, index) => {
        const sessionName = String(session?.name || "").trim();
        if (!sessionName) return;
        const openHref = `/open-session?session=${encodeURIComponent(sessionName)}`;
        const shouldPrimeFrame = index === 0;
        const runWarm = () => {
          if (token !== _prewarmToken) return;
          resolveChatUrl(openHref, sessionName, { prewarm: shouldPrimeFrame }).catch(() => {
            if (token !== _prewarmToken) return;
          });
        };
        const delayMs = shouldPrimeFrame ? 0 : Math.min(2500, index * 180);
        if (delayMs <= 0) runWarm();
        else setTimeout(runWarm, delayMs);
      });
    }
    function kickstartRememberedSessionPrewarm() {
      if (_chatOverlay && !_chatOverlay.hidden && !_chatOverlay.classList.contains("prewarming")) return;
      const sessionName = lastRememberedSession();
      if (!sessionName) return;
      const token = ++_prewarmToken;
      const openHref = `/open-session?session=${encodeURIComponent(sessionName)}`;
      resolveChatUrl(openHref, sessionName, { prewarm: true }).catch(() => {
        if (token !== _prewarmToken) return;
      });
    }
    function _bumpHubChatParentLayoutMax() {
      if (_chatOverlay.hidden) return;
      const ih = window.innerHeight || 0;
      const ch = document.documentElement.clientHeight || 0;
      _hubChatParentLayoutMax = Math.max(_hubChatParentLayoutMax, ih, ch);
      _postHubLayoutToChat();
    }
    function _postHubLayoutToChat() {
      const w = _chatFrame.contentWindow;
      if (!w || _chatOverlay.hidden) return;
      const iw = window.innerWidth || 0;
      const ih = window.innerHeight || 0;
      if (_hubLayoutRefW > 0 && _hubLayoutRefH > 0) {
        const b0 = _hubLayoutRefH >= _hubLayoutRefW;
        const b1 = ih >= iw;
        const diffH = Math.abs(_hubLayoutRefH - ih);
        if (b0 !== b1 && diffH > 150) {
          _hubMinParentChromeGap = Infinity;
        }
      }
      _hubLayoutRefW = iw;
      _hubLayoutRefH = ih;
      const vv = window.visualViewport;
      const vvH = vv ? vv.height : ih;
      const vvTop = vv ? vv.offsetTop : 0;
      const raw = Math.max(0, Math.round(ih - vvTop - vvH));
      if (raw < 150) {
        _hubMinParentChromeGap = Math.min(_hubMinParentChromeGap, raw);
      }
      const effectiveGap = raw >= 150 ? raw : _hubMinParentChromeGap;
      try {
        w.postMessage(
          {
            type: "hub-layout",
            layoutHeight: _hubChatParentLayoutMax,
            parentInnerHeight: ih,
            parentVvHeight: vvH,
            parentVvOffsetTop: vvTop,
            parentChromeGap: effectiveGap === Infinity ? raw : effectiveGap,
          },
          "*"
        );
      } catch (_) { }
    }
    function _attachHubViewportBridge() {
      if (_hubVVBridgeHandler) return;
      _hubVVBridgeHandler = () => { _bumpHubChatParentLayoutMax(); };
      window.addEventListener("resize", _hubVVBridgeHandler, { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", _hubVVBridgeHandler);
        window.visualViewport.addEventListener("scroll", _hubVVBridgeHandler);
      }
    }
    function _detachHubViewportBridge() {
      if (!_hubVVBridgeHandler) return;
      window.removeEventListener("resize", _hubVVBridgeHandler);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", _hubVVBridgeHandler);
        window.visualViewport.removeEventListener("scroll", _hubVVBridgeHandler);
      }
      _hubVVBridgeHandler = null;
    }
    function _fitChatOverlay() {
      if (_chatOverlay.hidden) return;
      _chatOverlay.style.top = "";
      _chatOverlay.style.height = "";
    }
    function updateMenuContext(isChat) {
      const bridge = document.getElementById("pageNativeMenuBridge");
      if (!bridge) return;
      if (isChat) {
        bridge.innerHTML = `
          <option value="" disabled selected>Menu</option>
          <option value="close-session">Close Session</option>
          <option value="restart-hub">Reload</option>
        `;
      } else {
        bridge.innerHTML = `
          <option value="" disabled selected>Menu</option>
          <option value="restart-hub">Reload</option>
        `;
      }
    }
    updateMenuContext(false);
    function openChatInFrame(url, name) {
      if (_chatOverlayCloseTimer) {
        clearTimeout(_chatOverlayCloseTimer);
        _chatOverlayCloseTimer = 0;
      }
      rememberLastSession(name);
      if (_hubLaunchShellPending) showLaunchShell();
      startChatRenderWait();
      const normalizedName = String(name || "").trim();
      const normalizedUrl = hubFrameChatUrl(url, normalizedName);
      cacheChatUrl(normalizedName, normalizedUrl);
      clearPersistedChatFrameState();
      _currentChatUrl = normalizedUrl;
      _hubMinParentChromeGap = Infinity;
      _hubLayoutRefW = window.innerWidth || 0;
      _hubLayoutRefH = window.innerHeight || 0;
      _hubChatParentLayoutMax = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
      const onChatReady = function () {
        _prewarmedSessionName = normalizedName;
        _prewarmedChatUrl = normalizedUrl;
        _prewarmedFrameReady = true;
        _chatFrame.style.transition = "opacity 140ms ease";
        _chatFrame.style.opacity = "1";
        _bumpHubChatParentLayoutMax();
        _postHubLayoutToChat();
        publishMobileTheme();
        if (_prewarmedFrameRenderReady) {
          persistChatFrameState(normalizedUrl, normalizedName);
          finishChatRenderWait();
        }
      };
      const canReusePrewarm =
        normalizedName &&
        _prewarmedFrameRenderReady &&
        _prewarmedSessionName === normalizedName &&
        normalizeComparableUrl(_prewarmedChatUrl) === normalizeComparableUrl(normalizedUrl) &&
        hubFrameSrcMatches(normalizedUrl);
      if (!canReusePrewarm) {
        _chatFrame.style.transition = "none";
        _chatFrame.style.opacity = "0";
      } else {
        _chatFrame.style.opacity = "1";
      }
      _chatFrame.onload = onChatReady;
      _attachHubViewportBridge();
      updateMenuContext(true);
      _hubPreOverlayScrollY = window.scrollY || document.documentElement.scrollTop || 0;
      document.documentElement.classList.add("hub-chat-overlay-active");
      document.body.classList.add("hub-chat-overlay-active");
      setPrewarmingOverlayActive(false);
      const _wasPeeking = _chatOverlay.classList.contains("overlay-peeking");
      document.documentElement.classList.remove("hub-chat-peeking");
      _chatOverlay.classList.remove("overlay-visible", "overlay-closing", "overlay-peeking");
      resetChatOverlayMotionStyles();
      _chatOverlay.hidden = false;
      if (_wasPeeking) {
        _chatOverlay.classList.add("overlay-visible");
        document.documentElement.classList.add("hub-chat-ui-active");
      } else {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (_chatOverlay.hidden || _chatOverlay.classList.contains("prewarming")) return;
            _chatOverlay.classList.add("overlay-visible");
            document.documentElement.classList.add("hub-chat-ui-active");
          });
        });
      }
      _currentChatSessionName = normalizedName;
      syncMobileSelectedSessionRows();
      if (!canReusePrewarm) {
        _prewarmedFrameReady = false;
        _prewarmedFrameRenderReady = false;
        if (hubFrameSrcMatches(normalizedUrl)) {
          _chatFrame.src = "about:blank";
        }
        _chatFrame.src = normalizedUrl;
      } else if (_prewarmedFrameReady) {
        requestAnimationFrame(onChatReady);
      }
      _fitChatOverlay();
    }
    function closeChatFrame() {
      cancelChatRenderWait();
      if (!_hubLaunchShellPending) hideLaunchShell();
      _detachHubViewportBridge();
      _chatFrame.style.transition = "";
      _chatFrame.style.opacity = "1";
      try {
        window.scrollTo(0, _hubPreOverlayScrollY);
      } catch (_) { }
      _chatFrame.onload = null;
      _chatOverlay.classList.remove("overlay-visible");
      document.documentElement.classList.remove("hub-chat-ui-active");
      resetChatOverlayMotionStyles();
      updateMenuContext(false);
      _chatOverlay.classList.add("overlay-closing");
      document.documentElement.classList.add("hub-chat-peeking");
      if (_chatOverlayCloseTimer) clearTimeout(_chatOverlayCloseTimer);
      _chatOverlayCloseTimer = setTimeout(() => {
        _chatOverlayCloseTimer = 0;
        document.documentElement.classList.remove("hub-chat-overlay-active");
        document.body.classList.remove("hub-chat-overlay-active");
        _chatOverlay.classList.remove("overlay-closing");
        resetChatOverlayMotionStyles();
        _chatOverlay.classList.add("overlay-peeking");
        _chatOverlay.style.top = "";
        _chatOverlay.style.height = "";
        _currentChatUrl = "";
        clearPersistedChatFrameState();
      }, CHAT_OVERLAY_CLOSE_MS);
    }
    function openSessionFrame(openHref, name) {
      rememberLastSession(name);
      resetLaunchShellCard();
      const needsReviveTransition = /^\/revive-session(?:[/?]|$)/.test(String(openHref || ""));
      if (needsReviveTransition) showLaunchShell();
      resolveChatUrl(openHref, name, { force: needsReviveTransition })
        .then((chatUrl) => {
          openChatInFrame(chatUrl, name);
          if (needsReviveTransition) {
            if (refreshMobSessions) void refreshMobSessions(true);
          }
        })
        .catch((err) => {
          failHubReadyWait(err?.message || "open session failed");
        });
    }
    window.addEventListener("message", function (e) {
      if (e.data && e.data.type === "chat-render-error" && e.source === _chatFrame.contentWindow) {
        _prewarmedFrameReady = false;
        _prewarmedFrameRenderReady = false;
        if (_chatOverlay.classList.contains("prewarming") || !_awaitingChatRenderReady) {
          return;
        }
        failHubReadyWait(e.data.message || "render failed");
        return;
      }
      if (e.data && e.data.type === "chat-render-ready" && e.source === _chatFrame.contentWindow) {
        _prewarmedFrameRenderReady = true;
        if (!_chatOverlay.hidden && !_chatOverlay.classList.contains("prewarming")) {
          _chatFrame.style.transition = "opacity 140ms ease";
          _chatFrame.style.opacity = "1";
          if (_currentChatUrl) {
            persistChatFrameState(_currentChatUrl, _currentChatSessionName || "");
          }
          finishChatRenderWait();
        }
        return;
      }
      if (e.data === "hub_close_chat") closeChatFrame();
      if (e.data && e.data.type === "toggle-hub-sidebar") {
        closeChatFrame();
        return;
      }
      if (e.data && e.data.type === "open-hub-path") {
        const nextUrl = typeof e.data.url === "string" ? e.data.url : "";
        if (nextUrl) {
          closeChatFrame();
          let sameHubRoot = false;
          try {
            const target = new URL(nextUrl, window.location.href);
            sameHubRoot = target.origin === window.location.origin && target.pathname === "/" && window.location.pathname === "/";
          } catch (_) { }
          if (!sameHubRoot) {
            setTimeout(() => {
              window.location.href = nextUrl;
            }, e.data.reveal ? CHAT_OVERLAY_CLOSE_MS : 0);
          }
        }
        return;
      }
      if (e.data && e.data.type === "chat-scroll-signal" && e.source === _chatFrame.contentWindow) {
        if (_chatOverlay.hidden) return;
        const y = window.scrollY || document.documentElement.scrollTop || 0;
        try {
          window.scrollTo(0, y + 1);
          window.scrollTo(0, y);
        } catch (_) { }
        return;
      }
      if (e.data && e.data.type === "chat-request-hub-layout" && e.source === _chatFrame.contentWindow) {
        _bumpHubChatParentLayoutMax();
        _postHubLayoutToChat();
        return;
      }
      if (e.data && e.data.type === "session-messages-changed" && e.source === _chatFrame.contentWindow) {
        if (refreshMobSessions) void refreshMobSessions(true);
        return;
      }
      if (e.data && e.data.type === "hub-mobile-system-theme-observed") {
        const theme = e.data.theme === "light" ? "light" : (e.data.theme === "dark" ? "dark" : "");
        if (theme) publishMobileTheme(theme);
        return;
      }
      if (e.data && e.data.type === "hub-theme-changed") {
        if (e.data.theme !== "light" && e.data.theme !== "dark") return;
        const theme = e.data.theme;
        document.documentElement.dataset.theme = theme;
        try { _chatFrame.contentDocument.documentElement.dataset.theme = theme; } catch (_) {}
        try { _chatFrame?.contentWindow?.postMessage({ type: "hub-theme-changed", theme }, "*"); } catch (_) {}
        return;
      }
    });
    const pendingHubErrorMessage = consumePendingHubErrorMessage();
    if (pendingHubErrorMessage) {
      clearPersistedChatFrameState();
      failHubReadyWait(pendingHubErrorMessage);
    }
    try {
      const saved = sessionStorage.getItem(HUB_CHAT_FRAME_KEY);
      if (saved && !pendingHubErrorMessage) {
        const { url, name } = JSON.parse(saved);
        if (url) openChatInFrame(url, name);
      }
    } catch (_) { }

    (function () {
      const wrap = document.getElementById("mobListWrap");
      if (!wrap) return;
      let _mobSessionsCache = { active: [], warnings: [], archived: [] };
      let _mobSessionsRequestSeq = 0;
      let _mobSessionsRenderedOnce = false;

      const esc = (v) => String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

      const SNAP_W = 84;
      const THRESH = 48;
      let anyOpen = null;
      const closeRow = (sr, animate) => {
        const el = sr && sr.querySelector(".mob-session-row");
        if (!el) return;
        el.style.transition = animate ? "transform 220ms cubic-bezier(.25,.46,.45,.94)" : "none";
        el.style.transform = "";
        sr._snap = 0;
      };
      const initSwipeRow = (sr) => {
        const inner = sr.querySelector(".mob-session-row");
        const actR = sr.querySelector(".swipe-act-right");
        const actL = sr.querySelector(".swipe-act-left");
        if (!inner) return;
        sr._snap = 0;
        let sx = 0, sy = 0, dx = 0, axis = null, active = false, didSwipe = false;
        const minX = actR ? -SNAP_W : 0;
        const maxX = actL ? SNAP_W : 0;
        const startDrag = (clientX, clientY) => {
          if (anyOpen && anyOpen !== sr) { closeRow(anyOpen, true); anyOpen = null; }
          sx = clientX; sy = clientY;
          dx = 0; axis = null; active = true; didSwipe = false;
          inner.style.transition = "none";
        };
        const moveDrag = (clientX, clientY, preventDefault) => {
          if (!active) return;
          const cx = clientX - sx, cy = clientY - sy;
          if (!axis) {
            if (Math.abs(cy) > Math.abs(cx) + 4) { axis = "y"; return; }
            if (Math.abs(cx) > 6) axis = "x";
          }
          if (axis !== "x") return;
          if (preventDefault) preventDefault();
          didSwipe = true;
          dx = cx;
          const base = (sr._snap || 0) * SNAP_W;
          const x = Math.max(minX, Math.min(maxX, base + dx));
          inner.style.transform = x ? `translateX(${x}px)` : "";
        };
        const endDrag = () => {
          if (!active || axis !== "x") { active = false; return; }
          active = false;
          const base = (sr._snap || 0) * SNAP_W;
          const fx = base + dx;
          const ease = "transform 220ms cubic-bezier(.25,.46,.45,.94)";
          if (fx < -THRESH && actR) {
            inner.style.transition = ease; inner.style.transform = `translateX(${-SNAP_W}px)`;
            sr._snap = -1; anyOpen = sr;
          } else if (fx > THRESH && actL) {
            inner.style.transition = ease; inner.style.transform = `translateX(${SNAP_W}px)`;
            sr._snap = 1; anyOpen = sr;
          } else {
            inner.style.transition = ease; inner.style.transform = "";
            sr._snap = 0; if (anyOpen === sr) anyOpen = null;
          }
          dx = 0;
        };
        inner.addEventListener("touchstart", (e) => startDrag(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
        inner.addEventListener("touchmove", (e) => moveDrag(e.touches[0].clientX, e.touches[0].clientY, () => e.preventDefault()), { passive: false });
        inner.addEventListener("touchend", endDrag, { passive: true });
        inner.addEventListener("mousedown", (e) => {
          if (e.target.closest("a, button")) return;
          e.preventDefault();
          startDrag(e.clientX, e.clientY);
          const onMove = (me) => moveDrag(me.clientX, me.clientY, () => me.preventDefault());
          const onUp = () => { endDrag(); document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
        if (actL) actL.addEventListener("click", (e) => {
          e.stopPropagation();
          const n = sr.dataset.sessionName;
          if (n) openSessionFrame(`/revive-session?session=${encodeURIComponent(n)}`, n);
        });
        if (actR) actR.addEventListener("click", (e) => {
          e.stopPropagation();
          const n = sr.dataset.sessionName;
          const action = actR.dataset.action;
          if (action === "delete-archived") {
            if (confirm("Delete archived logs for " + n + "? This cannot be undone.")) {
              window.location.href = `/delete-archived-session?session=${encodeURIComponent(n)}`;
            }
            return;
          }
          if (confirm("Archive " + n + "?")) window.location.href = `/kill-session?session=${encodeURIComponent(n)}`;
        });
        inner.addEventListener("click", (e) => {
          if (didSwipe) { didSwipe = false; e.stopPropagation(); return; }
          if (sr._snap !== 0) { closeRow(sr, true); anyOpen = null; e.stopPropagation(); return; }
          if (e.target.closest(".swipe-act")) return;
          const href = inner.dataset.openHref;
          if (href) openSessionFrame(href, sr.dataset.sessionName || "");
        });
      };

      const renderRows = (active, warnings, archived) => {
        let html = "";
        const trashSvg = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
        const killSvg = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`;
        const reviveSvg = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;
        if (active.length) {
          html += `<div class="mob-section-label">Active</div>`;
          html += active.map((s) => {
            const preview = s.latest_message_preview ? `<div class="mob-row-preview"><span class="sender">${esc(s.latest_message_sender || "latest")}</span> ${esc(s.latest_message_preview)}</div>` : "";
            return `<div class="swipe-row" data-session-name="${esc(s.name)}">` +
              `<div class="swipe-act swipe-act-right" data-action="kill">${killSvg}<span>Archive</span></div>` +
              `<div class="mob-session-row" data-session-name="${esc(s.name)}" data-open-href="/open-session?session=${encodeURIComponent(s.name)}" role="link" tabindex="0">` +
              `<div class="mob-row-head">` +
              `<div class="mob-row-name">${esc(s.name)}</div>` +
              `</div>` +
              preview +
              `</div></div>`;
          }).join("");
        }
        if (archived.length) {
          html += `<div class="mob-section-label">Archived</div>`;
          html += archived.map((s) => {
            const preview = s.latest_message_preview ? `<div class="mob-row-preview"><span class="sender">${esc(s.latest_message_sender || "latest")}</span> ${esc(s.latest_message_preview)}</div>` : "";
            return `<div class="swipe-row" data-session-name="${esc(s.name)}">` +
              `<div class="swipe-act swipe-act-left" data-action="revive">${reviveSvg}<span>Revive</span></div>` +
              `<div class="swipe-act swipe-act-right" data-action="delete-archived">${trashSvg}<span>Delete</span></div>` +
              `<div class="mob-session-row archived-row" data-session-name="${esc(s.name)}" data-open-href="/open-session?session=${encodeURIComponent(s.name)}" role="link" tabindex="0">` +
              `<div class="mob-row-head">` +
              `<div class="mob-row-name">${esc(s.name)}</div>` +
              `</div>` +
              preview +
              `</div></div>`;
          }).join("");
        }
        if (warnings.length) {
          html += `<div class="mob-section-label">Warning</div>`;
          html += warnings.map((s) =>
            `<div class="swipe-row mob-warning-row" data-session-name="${esc(s.name)}">` +
              `<div class="mob-session-row" data-session-name="${esc(s.name)}" aria-disabled="true">` +
                `<div class="mob-row-head"><div class="mob-row-name">${esc(s.name)}</div></div>` +
                `<div class="mob-row-preview">${esc(s.warning)}</div>` +
              `</div>` +
            `</div>`
          ).join("");
        }
        if (!active.length && !warnings.length && !archived.length) {
          html += `<div class="mob-empty">No sessions found</div>`;
        }
        wrap.innerHTML = html;
        syncMobileSelectedSessionRows();
        wrap.querySelectorAll(".swipe-row:not(.mob-warning-row)").forEach(initSwipeRow);
      };
      const refresh = async (force) => {
        const requestSeq = ++_mobSessionsRequestSeq;
        try {
          const res = await fetch(`/sessions?ts=${Date.now()}`, { cache: "no-store" });
          if (!res.ok) throw new Error("failed");
          const data = await res.json();
          if (requestSeq !== _mobSessionsRequestSeq) return;
          const activeSessions = data.active_sessions;
          const warningSessions = data.warning_sessions;
          const archivedSessions = data.archived_sessions;
          _mobSessionsCache = { active: activeSessions, warnings: warningSessions, archived: archivedSessions };

          const sig = JSON.stringify({
            active: activeSessions,
            warnings: warningSessions,
            archived: archivedSessions,
          });
          if (!force && window._lastMobRenderSig === sig) {
            _mobSessionsRenderedOnce = true;
            scheduleActiveSessionPrewarm(activeSessions);
            releaseHubLaunchShellAfterRender();
            return;
          }
          window._lastMobRenderSig = sig;

          renderRows(activeSessions, warningSessions, archivedSessions);
          _mobSessionsRenderedOnce = true;
          scheduleActiveSessionPrewarm(activeSessions);
          releaseHubLaunchShellAfterRender();
        } catch (_) {
          if (requestSeq !== _mobSessionsRequestSeq) return;
          if (_mobSessionsRenderedOnce || _mobSessionsCache.active.length || _mobSessionsCache.warnings.length || _mobSessionsCache.archived.length) return;
          wrap.innerHTML = `<div class="mob-empty">Failed to load sessions</div>`;
          if (_hubLaunchShellPending) failHubReadyWait("Failed to load sessions");
        }
      };
      kickstartRememberedSessionPrewarm();
      refreshMobSessions = refresh;
      refresh();
    })();

    (function () {
      var bridge = document.getElementById("pageNativeMenuBridge");
      if (bridge) {
        bridge.addEventListener("change", function (e) {
          var val = bridge.value;
          if (!val) return;
          if (val === "close-session" || val === "hub") {
            e.stopImmediatePropagation();
            bridge.value = "";
            closeChatFrame();
          }
        });
      }
    })();


    __HUB_HEADER_JS__
