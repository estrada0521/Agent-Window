    const HUB_SESSION_SCROLL_ORIGIN = document.querySelector(".mob-list-top-spacer").offsetHeight;
    const resetHubSessionScroll = () => window.scrollTo(0, HUB_SESSION_SCROLL_ORIGIN);
    resetHubSessionScroll();
    const _roomOverlay = document.getElementById("roomOverlay");
    const _roomOverlaySvg = _roomOverlay.querySelector(".room-overlay-shape");
    const _roomOverlayShape = _roomOverlaySvg.querySelector("path");
    const _roomFrameClip = _roomOverlay.querySelector(".room-frame-clip");
    const _roomFrame = document.getElementById("roomFrame");
    const _launchShell = document.getElementById("launchShell");
    const { setStatus, setResidentStatus } = createHud(document.getElementById("hubHud"));
    let _hubRoomParentLayoutMax = 0;
    let _hubMinParentChromeGap = Infinity;
    let _hubLayoutRefW = 0;
    let _hubLayoutRefH = 0;
    let _hubVVBridgeHandler = null;
    let _currentRoomSessionName = "";
    let _currentRoomUrl = "";
    let _roomFrameRenderReady = false;
    let _hubLaunchShellPending = false;
    let _awaitingRoomRenderReady = false;
    let _hubReadyTimeoutTimer = 0;
    let _roomOverlayCloseTimer = 0;
    document.addEventListener("touchstart", (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      const width = window.innerWidth || 0;
      if (touch.clientX < 24 || touch.clientX > width - 24) event.preventDefault();
    }, { capture: true, passive: false });
    let refreshMobSessions = null;
    const HUB_ROOM_FRAME_KEY = "hub_room_frame";
    const HUB_LAST_SESSION_KEY = "agent_window_hub_last_session_name";
    const HUB_PENDING_ERROR_KEY = "agent_window_hub_pending_error";
    const HUB_ROOM_URL_CACHE_TTL_MS = 180000;
    const HUB_ROOM_URL_CACHE_LIMIT = 3;
    const HUB_LAUNCH_SHELL_PARAM = "launch_shell";
    const hubRoomUrls = createHubRoomUrlResolver({
      cacheLimit: HUB_ROOM_URL_CACHE_LIMIT,
      ttlMs: HUB_ROOM_URL_CACHE_TTL_MS,
      cacheKey: (openHref, name) => String(name || "").trim() || String(openHref || "").trim(),
      wrapUrl: (url) => hubFrameRoomUrl(url),
      errorMessage: "open session failed",
    });
    const applyMobThemeGradientVars = () => {
      const root = document.documentElement;
      const channels = getComputedStyle(root).getPropertyValue("--bg-rgb").trim();
      if (channels) root.style.setProperty("--mob-top-gradient-rgb", channels);
    };
    applyMobThemeGradientVars();
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "data-theme")) {
        applyMobThemeGradientVars();
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const MOBILE_THEME_KEY = "agent_window_theme_mobile";
    const currentMobileThemeSetting = () => {
      const value = document.documentElement.dataset.themeMobile;
      return ["system", "light", "dark"].includes(value)
        ? value
        : document.documentElement.dataset.themeMobileDefault;
    };
    const resolveMobileTheme = (observedTheme = "") => {
      const setting = currentMobileThemeSetting();
      if (setting !== "system") return setting;
      if (observedTheme === "light" || observedTheme === "dark") return observedTheme;
      try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch (_) { return "dark"; }
    };
    const publishMobileTheme = (observedTheme = "") => {
      const theme = resolveMobileTheme(observedTheme);
      const root = document.documentElement;
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
      applyMobThemeGradientVars();
      _roomFrame?.contentWindow?.postMessage({
        type: "hub-theme-changed",
        theme,
        themeMobile: currentMobileThemeSetting(),
      }, "*");
      return theme;
    };
    const applyMobileThemeSetting = (setting) => {
      if (!["system", "light", "dark"].includes(setting)) return;
      document.documentElement.dataset.themeMobile = setting;
      localStorage.setItem(MOBILE_THEME_KEY, setting);
      publishMobileTheme();
    };
    publishMobileTheme();
    const refreshSystemMobileTheme = () => {
      if (currentMobileThemeSetting() === "system") publishMobileTheme();
    };
    try {
      const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
      if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener("change", refreshSystemMobileTheme);
      else if (systemThemeQuery.addListener) systemThemeQuery.addListener(refreshSystemMobileTheme);
    } catch (_) {}
    window.addEventListener("pageshow", refreshSystemMobileTheme);
    window.addEventListener("focus", refreshSystemMobileTheme);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshSystemMobileTheme();
    });
    const HUB_READY_TIMEOUT_MS = 5000;
    const ROOM_OVERLAY_CLOSE_MS = 300;
    function resetRoomOverlayMotionStyles() {
      _roomOverlay.style.transform = "";
      _roomOverlay.style.transition = "";
      _roomOverlay.style.opacity = "";
    }
    const ROOM_OVERLAY_SLIDE_MS = 440;
    const ROOM_OVERLAY_SETTLE_LEAD_MS = 130;
    let _overlaySettleHandler = null;
    let _overlaySettleTimer = 0;
    function clearOverlaySettle() {
      if (_overlaySettleHandler) {
        _roomOverlay.removeEventListener("transitionend", _overlaySettleHandler);
        _overlaySettleHandler = null;
      }
      if (_overlaySettleTimer) {
        clearTimeout(_overlaySettleTimer);
        _overlaySettleTimer = 0;
      }
      _roomOverlay.classList.remove("overlay-settled");
      applyHubRoomSquircle();
    }
    function armOverlaySettle() {
      clearOverlaySettle();
      const settle = () => {
        clearOverlaySettle();
        if (_roomOverlay.classList.contains("overlay-visible")) {
          _roomOverlay.classList.add("overlay-settled");
          applyHubRoomSquircle();
          resetHubSessionScroll();
        }
      };
      _overlaySettleHandler = (event) => {
        if (event.target !== _roomOverlay || event.propertyName !== "transform") return;
        settle();
      };
      _roomOverlay.addEventListener("transitionend", _overlaySettleHandler);
      _overlaySettleTimer = setTimeout(settle, Math.max(0, ROOM_OVERLAY_SLIDE_MS - ROOM_OVERLAY_SETTLE_LEAD_MS));
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
    function stopHubReadyWait() {
      _hubLaunchShellPending = false;
      _awaitingRoomRenderReady = false;
      clearHubReadyTimeout();
      clearLaunchShellQueryFlag();
      hideLaunchShell();
    }
    function failHubReadyWait(message) {
      stopHubReadyWait();
      setStatus(message);
    }
    function startHubReadyTimeout() {
      if (_hubReadyTimeoutTimer) return;
      resetLaunchShellCard();
      _hubReadyTimeoutTimer = setTimeout(() => {
        failHubReadyWait("timeout");
      }, HUB_READY_TIMEOUT_MS);
    }
    function finishHubReadyWaitIfComplete() {
      if (_hubLaunchShellPending || _awaitingRoomRenderReady) return;
      clearHubReadyTimeout();
      hideLaunchShell();
    }
    function clearLaunchShellQueryFlag() {
      const params = new URLSearchParams(window.location.search || "");
      if (!params.has(HUB_LAUNCH_SHELL_PARAM)) return;
      params.delete(HUB_LAUNCH_SHELL_PARAM);
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash || ""}`;
      window.history.replaceState(window.history.state, "", nextUrl);
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
    function startRoomRenderWait() {
      _awaitingRoomRenderReady = true;
      startHubReadyTimeout();
    }
    function finishRoomRenderWait() {
      if (!_awaitingRoomRenderReady) return;
      _awaitingRoomRenderReady = false;
      finishHubReadyWaitIfComplete();
    }
    function cancelRoomRenderWait() {
      _awaitingRoomRenderReady = false;
      finishHubReadyWaitIfComplete();
    }
    const _launchShellParams = new URLSearchParams(window.location.search || "");
    _hubLaunchShellPending = _launchShellParams.get(HUB_LAUNCH_SHELL_PARAM) === "1";
    const _restoreLatestSessionOnLaunch = _hubLaunchShellPending;
    if (_hubLaunchShellPending) {
      showLaunchShell();
      startHubReadyTimeout();
    }
    function rememberLastSession(name) {
      const normalized = String(name || "").trim();
      if (!normalized) return;
      localStorage.setItem(HUB_LAST_SESSION_KEY, normalized);
    }
    function lastRememberedSession() {
      return localStorage.getItem(HUB_LAST_SESSION_KEY) || "";
    }
    function syncMobileSelectedSessionRows() {
      const selectedName = String(_currentRoomSessionName || lastRememberedSession() || "").trim();
      document.querySelectorAll("#mobListWrap .mob-session-row[data-session-name]").forEach((row) => {
        const isSelected = !!selectedName && row.dataset.sessionName === selectedName;
        row.classList.toggle("is-selected", isSelected);
        if (isSelected) row.setAttribute("aria-current", "page");
        else row.removeAttribute("aria-current");
      });
    }
    function persistRoomFrameState(url, name) {
      const normalizedUrl = String(url || "").trim();
      if (!normalizedUrl) return;
      const normalizedName = String(name || "").trim();
      sessionStorage.setItem(HUB_ROOM_FRAME_KEY, JSON.stringify({ url: normalizedUrl, name: normalizedName }));
    }
    function clearPersistedRoomFrameState() {
      sessionStorage.removeItem(HUB_ROOM_FRAME_KEY);
    }
    function consumePendingHubErrorMessage() {
      const message = sessionStorage.getItem(HUB_PENDING_ERROR_KEY) || "";
      if (message) sessionStorage.removeItem(HUB_PENDING_ERROR_KEY);
      return message;
    }
    function hubFrameRoomUrl(roomUrl) {
      const raw = String(roomUrl || "").trim();
      if (!raw) return raw;
      try {
        const next = new URL(raw, window.location.href);
        if (next.hostname !== window.location.hostname) return raw;
        next.searchParams.set("view", "mobile");
        next.searchParams.set("theme", resolveMobileTheme());
        next.searchParams.set("theme_mobile", currentMobileThemeSetting());
        return next.origin === window.location.origin
          ? next.pathname + next.search + next.hash
          : next.toString();
      } catch (_) {}
      return raw;
    }
    function hubFrameSrcMatches(url) {
      const current = normalizeComparableUrl(_roomFrame.src);
      const next = normalizeComparableUrl(url);
      return !!current && !!next && current === next;
    }
    function cacheRoomUrl(name, url) {
      hubRoomUrls.write(name, url);
    }
    function _bumpHubRoomParentLayoutMax() {
      if (_roomOverlay.hidden) return;
      const ih = window.innerHeight || 0;
      const ch = document.documentElement.clientHeight || 0;
      _hubRoomParentLayoutMax = Math.max(_hubRoomParentLayoutMax, ih, ch);
      _postHubLayoutToRoom();
    }
    function _postHubLayoutToRoom() {
      const w = _roomFrame.contentWindow;
      if (!w || _roomOverlay.hidden) return;
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
      w.postMessage(
        {
          type: "hub-layout",
          layoutHeight: _hubRoomParentLayoutMax,
          parentInnerHeight: ih,
          parentVvHeight: vvH,
          parentVvOffsetTop: vvTop,
          parentChromeGap: effectiveGap === Infinity ? raw : effectiveGap,
        },
        "*"
      );
    }
    function _attachHubViewportBridge() {
      if (_hubVVBridgeHandler) return;
      _hubVVBridgeHandler = () => {
        _bumpHubRoomParentLayoutMax();
        applyHubRoomSquircle();
      };
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
    function hubRoomSquirclePath(width, height) {
      const radius = 160 / 3;
      const smoothing = 0.6;
      const budget = Math.min(width, height) / 2;
      const s = Math.min(smoothing, budget / radius - 1);
      const p = Math.min((1 + s) * radius, budget);
      const arcMeasure = 90 * (1 - s);
      const rad = (deg) => deg * Math.PI / 180;
      const arc = Math.sin(rad(arcMeasure / 2)) * radius * Math.SQRT2;
      const p3 = radius * Math.tan(rad((90 - arcMeasure) / 4));
      const beta = rad(45 * s);
      const c = p3 * Math.cos(beta);
      const d = c * Math.tan(beta);
      const b = (p - arc - c - d) / 3;
      const a = 2 * b;
      const n = (value) => value.toFixed(4);
      return (
        `M ${n(width - p)} 0 ` +
        `c ${n(a)} 0 ${n(a + b)} 0 ${n(a + b + c)} ${n(d)} ` +
        `a ${n(radius)} ${n(radius)} 0 0 1 ${n(arc)} ${n(arc)} ` +
        `c ${n(d)} ${n(c)} ${n(d)} ${n(b + c)} ${n(d)} ${n(a + b + c)} ` +
        `L ${n(width)} ${n(height - p)} ` +
        `c 0 ${n(a)} 0 ${n(a + b)} ${n(-d)} ${n(a + b + c)} ` +
        `a ${n(radius)} ${n(radius)} 0 0 1 ${n(-arc)} ${n(arc)} ` +
        `c ${n(-c)} ${n(d)} ${n(-(b + c))} ${n(d)} ${n(-(a + b + c))} ${n(d)} ` +
        `L ${n(p)} ${n(height)} ` +
        `c ${n(-a)} 0 ${n(-(a + b))} 0 ${n(-(a + b + c))} ${n(-d)} ` +
        `a ${n(radius)} ${n(radius)} 0 0 1 ${n(-arc)} ${n(-arc)} ` +
        `c ${n(-d)} ${n(-c)} ${n(-d)} ${n(-(b + c))} ${n(-d)} ${n(-(a + b + c))} ` +
        `L 0 ${n(p)} ` +
        `c 0 ${n(-a)} 0 ${n(-(a + b))} ${n(d)} ${n(-(a + b + c))} ` +
        `a ${n(radius)} ${n(radius)} 0 0 1 ${n(arc)} ${n(-arc)} ` +
        `c ${n(c)} ${n(-d)} ${n(b + c)} ${n(-d)} ${n(a + b + c)} ${n(-d)} ` +
        "Z"
      );
    }
    function applyHubRoomSquircle() {
      const wide = window.matchMedia("(min-width: 600px)").matches;
      const settled = _roomOverlay.classList.contains("overlay-settled");
      if (wide || settled || _roomOverlay.hidden) {
        _roomOverlayShape.removeAttribute("d");
        _roomFrameClip.style.webkitMaskImage = "";
        _roomFrameClip.style.maskImage = "";
        return;
      }
      const width = _roomOverlay.clientWidth;
      const height = _roomOverlay.clientHeight;
      if (width < 1 || height < 1) return;
      const d = hubRoomSquirclePath(width, height);
      _roomOverlayShape.setAttribute("d", d);
      _roomOverlaySvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      _roomOverlaySvg.setAttribute("preserveAspectRatio", "none");
      const mask = `url("data:image/svg+xml;utf8,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path fill="white" d="${d}"/></svg>`
      )}")`;
      _roomFrameClip.style.webkitMaskImage = mask;
      _roomFrameClip.style.maskImage = mask;
    }
    function _fitRoomOverlay() {
      if (_roomOverlay.hidden) return;
      _roomOverlay.style.top = "";
      _roomOverlay.style.height = "";
      applyHubRoomSquircle();
    }
    let skipThemeMenuBlur = false;
    const resetThemeNativeMenu = () => {
      const select = document.getElementById("themeNativeMenuSelect");
      if (!select) return;
      select.value = "";
      select.style.top = "-9999px";
      select.style.left = "-9999px";
    };
    const themeNativeMenuIsArmed = () => {
      const select = document.getElementById("themeNativeMenuSelect");
      return !!(select && select.options.length > 1 && select.style.top !== "-9999px");
    };
    const showArmedThemeNativeMenu = () => {
      const select = document.getElementById("themeNativeMenuSelect");
      if (!select || !themeNativeMenuIsArmed()) return false;
      if (typeof select.showPicker === "function") {
        try {
          select.showPicker();
          return true;
        } catch (_) {}
      }
      select.focus({ preventScroll: true });
      select.click();
      return true;
    };
    const ensureThemeNativeMenu = () => {
      let select = document.getElementById("themeNativeMenuSelect");
      if (select) return select;
      select = document.createElement("select");
      select.id = "themeNativeMenuSelect";
      select.setAttribute("aria-hidden", "true");
      select.tabIndex = -1;
      select.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0.001;pointer-events:auto;appearance:none;-webkit-appearance:none;border:0;outline:none;background:transparent;color:transparent;font-size:13px;z-index:1000";
      select.innerHTML = '<option value="" disabled selected>Theme</option><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>';
      select.addEventListener("change", () => {
        const setting = String(select.value || "");
        resetThemeNativeMenu();
        applyMobileThemeSetting(setting);
      });
      select.addEventListener("blur", () => {
        setTimeout(() => {
          if (!skipThemeMenuBlur) resetThemeNativeMenu();
        }, 0);
      });
      document.body.appendChild(select);
      return select;
    };
    const openThemeNativeMenu = () => {
      const select = ensureThemeNativeMenu();
      const menuButton = document.getElementById("pageMenuBtn");
      const rect = menuButton?.getBoundingClientRect() || { left: 0, top: 0, width: 1, height: 1 };
      select.value = "";
      select.style.left = `${Math.max(0, Math.round(rect.left))}px`;
      select.style.top = `${Math.max(0, Math.round(rect.top))}px`;
      select.style.width = `${Math.max(1, Math.round(rect.width || 1))}px`;
      select.style.height = `${Math.max(1, Math.round(rect.height || 1))}px`;
      skipThemeMenuBlur = true;
      showArmedThemeNativeMenu();
    };
    function updateMenuContext(isRoom) {
      const bridge = document.getElementById("pageNativeMenuBridge");
      if (!bridge) return;
      if (isRoom) {
        bridge.innerHTML = `
          <option value="" disabled selected>Menu</option>
          <option value="close-session">Close Session</option>
          <option value="theme">Theme</option>
          <option value="restart-hub">Reload</option>
        `;
      } else {
        bridge.innerHTML = `
          <option value="" disabled selected>Menu</option>
          <option value="theme">Theme</option>
          <option value="restart-hub">Reload</option>
        `;
      }
    }
    updateMenuContext(false);
    function openRoomInFrame(url, name) {
      if (_roomOverlayCloseTimer) {
        clearTimeout(_roomOverlayCloseTimer);
        _roomOverlayCloseTimer = 0;
      }
      rememberLastSession(name);
      if (_hubLaunchShellPending) showLaunchShell();
      startRoomRenderWait();
      const normalizedName = String(name || "").trim();
      const normalizedUrl = hubFrameRoomUrl(url, normalizedName);
      cacheRoomUrl(normalizedName, normalizedUrl);
      clearPersistedRoomFrameState();
      _currentRoomUrl = normalizedUrl;
      _hubMinParentChromeGap = Infinity;
      _hubLayoutRefW = window.innerWidth || 0;
      _hubLayoutRefH = window.innerHeight || 0;
      _hubRoomParentLayoutMax = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
      const onRoomReady = function () {
        const frameDoc = _roomFrame.contentDocument;
        if (frameDoc?.URL === "about:blank") return;
        if (!frameDoc?.getElementById("roomHud")) {
          const firstLine = (frameDoc?.body?.innerText || "").trim().split("\n")[0];
          dismissRoomFrame();
          failHubReadyWait(firstLine || "Empty response");
          return;
        }
        _roomFrame.style.transition = "opacity 140ms ease";
        _roomFrame.style.opacity = "1";
        _bumpHubRoomParentLayoutMax();
        _postHubLayoutToRoom();
        publishMobileTheme();
        if (_roomFrameRenderReady) {
          persistRoomFrameState(normalizedUrl, normalizedName);
          finishRoomRenderWait();
        }
      };
      const reuseLoadedFrame =
        !!normalizedName && _roomFrameRenderReady && hubFrameSrcMatches(normalizedUrl);
      _roomFrame.style.transition = "none";
      _roomFrame.style.opacity = reuseLoadedFrame ? "1" : "0";
      _roomFrame.onload = onRoomReady;
      _attachHubViewportBridge();
      updateMenuContext(true);
      document.documentElement.classList.add("hub-room-overlay-active");
      document.body.classList.add("hub-room-overlay-active");
      const _wasPeeking = _roomOverlay.classList.contains("overlay-peeking");
      document.documentElement.classList.remove("hub-room-peeking");
      _roomOverlay.classList.remove("overlay-visible", "overlay-closing", "overlay-peeking");
      clearOverlaySettle();
      resetRoomOverlayMotionStyles();
      _roomOverlay.hidden = false;
      if (_wasPeeking) {
        _roomOverlay.classList.add("overlay-visible");
        armOverlaySettle();
        document.documentElement.classList.add("hub-room-ui-active");
      } else {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (_roomOverlay.hidden) return;
            _roomOverlay.classList.add("overlay-visible");
            armOverlaySettle();
            document.documentElement.classList.add("hub-room-ui-active");
          });
        });
      }
      _currentRoomSessionName = normalizedName;
      syncMobileSelectedSessionRows();
      if (reuseLoadedFrame) {
        requestAnimationFrame(onRoomReady);
      } else {
        _roomFrameRenderReady = false;
        if (hubFrameSrcMatches(normalizedUrl)) {
          _roomFrame.src = "about:blank";
        }
        _roomFrame.src = normalizedUrl;
      }
      _fitRoomOverlay();
    }
    function closeRoomFrame() {
      cancelRoomRenderWait();
      if (!_hubLaunchShellPending) hideLaunchShell();
      _detachHubViewportBridge();
      _roomFrame.style.transition = "";
      _roomFrame.style.opacity = "1";
      _roomFrame.onload = null;
      _roomOverlay.classList.remove("overlay-visible");
      clearOverlaySettle();
      document.documentElement.classList.remove("hub-room-ui-active");
      resetRoomOverlayMotionStyles();
      updateMenuContext(false);
      _roomOverlay.classList.add("overlay-closing");
      document.documentElement.classList.add("hub-room-peeking");
      if (_roomOverlayCloseTimer) clearTimeout(_roomOverlayCloseTimer);
      _roomOverlayCloseTimer = setTimeout(() => {
        _roomOverlayCloseTimer = 0;
        document.documentElement.classList.remove("hub-room-overlay-active");
        document.body.classList.remove("hub-room-overlay-active");
        _roomOverlay.classList.remove("overlay-closing");
        resetRoomOverlayMotionStyles();
        _roomOverlay.classList.add("overlay-peeking");
        _roomOverlay.style.top = "";
        _roomOverlay.style.height = "";
        _currentRoomUrl = "";
        clearPersistedRoomFrameState();
      }, ROOM_OVERLAY_CLOSE_MS);
    }
    function dismissRoomFrame() {
      cancelRoomRenderWait();
      _detachHubViewportBridge();
      if (_roomOverlayCloseTimer) {
        clearTimeout(_roomOverlayCloseTimer);
        _roomOverlayCloseTimer = 0;
      }
      _roomFrame.onload = null;
      _roomFrame.src = "about:blank";
      _roomFrame.style.transition = "";
      _roomFrame.style.opacity = "1";
      _roomOverlay.classList.remove("overlay-visible", "overlay-closing", "overlay-peeking");
      clearOverlaySettle();
      resetRoomOverlayMotionStyles();
      _roomOverlay.style.top = "";
      _roomOverlay.style.height = "";
      _roomOverlay.hidden = true;
      document.documentElement.classList.remove("hub-room-ui-active", "hub-room-peeking", "hub-room-overlay-active");
      document.body.classList.remove("hub-room-overlay-active");
      updateMenuContext(false);
      _currentRoomUrl = "";
      _currentRoomSessionName = "";
      syncMobileSelectedSessionRows();
      clearPersistedRoomFrameState();
    }
    _roomOverlay.addEventListener("click", () => {
      if (!_roomOverlay.classList.contains("overlay-peeking")) return;
      const roomUrl = _roomFrame.src;
      if (!roomUrl || roomUrl === "about:blank") return;
      openRoomInFrame(roomUrl, _currentRoomSessionName);
    });
    function openSessionFrame(openHref, name) {
      rememberLastSession(name);
      resetLaunchShellCard();
      const needsReviveTransition = /^\/revive-session(?:[/?]|$)/.test(String(openHref || ""));
      if (needsReviveTransition) showLaunchShell();
      return hubRoomUrls.resolve(openHref, name, { force: needsReviveTransition })
        .then((roomUrl) => {
          openRoomInFrame(roomUrl, name);
          if (needsReviveTransition) {
            if (refreshMobSessions) void refreshMobSessions(true);
          }
        })
        .catch((err) => {
          failHubReadyWait(err?.message || "open session failed");
        });
    }
    window.addEventListener("message", function (e) {
      if (e.data && e.data.type === "room-render-error" && e.source === _roomFrame.contentWindow) {
        _roomFrameRenderReady = false;
        if (!_awaitingRoomRenderReady) {
          return;
        }
        stopHubReadyWait();
        return;
      }
      if (e.data && e.data.type === "room-render-ready" && e.source === _roomFrame.contentWindow) {
        _roomFrameRenderReady = true;
        if (!_roomOverlay.hidden) {
          _roomFrame.style.transition = "opacity 140ms ease";
          _roomFrame.style.opacity = "1";
          if (_currentRoomUrl) {
            persistRoomFrameState(_currentRoomUrl, _currentRoomSessionName || "");
          }
          finishRoomRenderWait();
        }
        return;
      }
      if (e.data === "hub_close_room") closeRoomFrame();
      if (e.data && e.data.type === "toggle-hub-sidebar") {
        closeRoomFrame();
        return;
      }
      if (e.data && e.data.type === "open-hub-path") {
        const nextUrl = typeof e.data.url === "string" ? e.data.url : "";
        if (nextUrl) {
          closeRoomFrame();
          let sameHubRoot = false;
          try {
            const target = new URL(nextUrl, window.location.href);
            sameHubRoot = target.origin === window.location.origin && target.pathname === "/" && window.location.pathname === "/";
          } catch (_) { }
          if (!sameHubRoot) {
            setTimeout(() => {
              window.location.href = nextUrl;
            }, e.data.reveal ? ROOM_OVERLAY_CLOSE_MS : 0);
          }
        }
        return;
      }
      if (e.data && e.data.type === "room-scroll-signal" && e.source === _roomFrame.contentWindow) {
        if (_roomOverlay.hidden) return;
        const y = window.scrollY || document.documentElement.scrollTop || 0;
        try {
          window.scrollTo(0, y + 1);
          window.scrollTo(0, y);
        } catch (_) { }
        return;
      }
      if (e.data && e.data.type === "room-request-hub-layout" && e.source === _roomFrame.contentWindow) {
        _bumpHubRoomParentLayoutMax();
        _postHubLayoutToRoom();
        return;
      }
      if (e.data && e.data.type === "hub-mobile-system-theme-observed" && currentMobileThemeSetting() === "system") {
        const theme = e.data.theme === "light" ? "light" : (e.data.theme === "dark" ? "dark" : "");
        if (theme) publishMobileTheme(theme);
        return;
      }
      if (e.data && e.data.type === "hub-theme-changed") {
        if (e.data.theme !== "light" && e.data.theme !== "dark") return;
        const theme = e.data.theme;
        document.documentElement.dataset.theme = theme;
        _roomFrame?.contentWindow?.postMessage({ type: "hub-theme-changed", theme }, "*");
        return;
      }
    });
    const pendingHubErrorMessage = consumePendingHubErrorMessage();
    if (pendingHubErrorMessage) {
      clearPersistedRoomFrameState();
      failHubReadyWait(pendingHubErrorMessage);
    }
    const savedRoomFrame = sessionStorage.getItem(HUB_ROOM_FRAME_KEY);
    if (savedRoomFrame && !pendingHubErrorMessage) {
      const { url, name } = JSON.parse(savedRoomFrame);
      openRoomInFrame(url, name);
    }

    (function () {
      const wrap = document.getElementById("mobListWrap");
      if (!wrap) return;
      let _mobSessionsCache = { active: [], archived: [] };
      let _mobSessionsRequestSeq = 0;
      let _mobSessionsRenderedOnce = false;

      const esc = (v) => String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

      const SNAP_EASE = "transform 720ms cubic-bezier(.2, .85, .14, 1)";
      const ACT_W = 52;
      const ACT_GAP = 8;
      const TRAY_INSET = 10;
      const THRESH = 36;
      const trashSvg = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
      const killSvg = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="18.55 8.44 18.55 20 5.46 20 5.46 8.44"/><rect x="4" y="4" width="16" height="4.44"/><line x1="10.55" y1="12" x2="13.45" y2="12"/></svg>`;
      const reviveSvg = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="2.22 4.89 2.22 10.22 7.56 10.22"/><path d="M4.45 14.67a8 8 0 1 0 1.89-8.32L2.22 10.22"/></svg>`;
      const SWIPE_ACTIONS = {
        kill: {
          svg: killSvg,
          label: "Archive",
          tone: "warn",
          title: "Archive — Kill tmux session; keep log",
        },
        "delete-archived": {
          svg: trashSvg,
          label: "Delete",
          tone: "danger",
          title: "Delete — Delete ~/.agent-window/log/{session}",
        },
        revive: {
          svg: reviveSvg,
          label: "Revive",
          tone: "success",
          title: "Revive — Restart tmux session with saved agent topology",
        },
      };
      let anyOpen = null;
      const removeSwipeActs = (sr) => {
        const tray = sr.querySelector(".swipe-act-tray");
        if (tray) tray.remove();
        sr.classList.remove("swipe-settling");
        sr.style.removeProperty("--swipe-p");
      };
      const closeRow = (sr, animate) => {
        const el = sr && sr.querySelector(".mob-session-row");
        if (!el) return;
        el.style.transition = animate ? SNAP_EASE : "none";
        el.style.transform = "";
        sr._snap = 0;
        sr.classList.remove("swipe-open");
        if (animate) sr.classList.add("swipe-settling");
        sr.style.setProperty("--swipe-p", "0");
        if (animate) {
          el.addEventListener("transitionend", () => removeSwipeActs(sr), { once: true });
        } else {
          removeSwipeActs(sr);
        }
      };
      const initSwipeRow = (sr) => {
        const inner = sr.querySelector(".mob-session-row");
        if (!inner) return;
        const acts = (sr.dataset.swipeRight || "").split(",")
          .map((name) => name.trim())
          .map((name) => ({ name, def: SWIPE_ACTIONS[name] }))
          .filter((a) => a.def);
        sr._snap = 0;
        let sx = 0, sy = 0, dx = 0, axis = null, active = false, didSwipe = false;
        const SNAP_W = acts.length
          ? acts.length * ACT_W + (acts.length - 1) * ACT_GAP + TRAY_INSET
          : 0;
        const minX = -SNAP_W;
        const onActClick = (e) => {
          e.stopPropagation();
          const action = e.currentTarget.dataset.action;
          const n = sr.dataset.sessionName;
          if (action === "revive") {
            if (n) openSessionFrame(`/revive-session?session=${encodeURIComponent(n)}`, n);
            return;
          }
          if (action === "delete-archived") {
            if (confirm("Delete archived logs for " + n + "? This cannot be undone.")) {
              window.location.href = `/delete-archived-session?session=${encodeURIComponent(n)}`;
            }
            return;
          }
          if (confirm("Archive " + n + "?")) window.location.href = `/kill-session?session=${encodeURIComponent(n)}`;
        };
        const ensureActs = () => {
          if (!acts.length || sr.querySelector(".swipe-act-tray")) return;
          const tray = document.createElement("div");
          tray.className = "swipe-act-tray";
          acts.forEach(({ name, def }) => {
            const el = document.createElement("div");
            el.className = "swipe-act";
            el.dataset.action = name;
            el.title = def.title;
            el.innerHTML = `<span class="swipe-act-btn is-${def.tone}">${def.svg}</span><span>${def.label}</span>`;
            el.addEventListener("click", onActClick);
            tray.appendChild(el);
          });
          sr.insertBefore(tray, inner);
          sr.classList.remove("swipe-settling");
          sr.style.setProperty("--swipe-p", "0");
        };
        const startDrag = (clientX, clientY) => {
          if (anyOpen && anyOpen !== sr) { closeRow(anyOpen, true); anyOpen = null; }
          sx = clientX; sy = clientY;
          dx = 0; axis = null; active = true; didSwipe = false;
          if (!sr._snap) {
            inner.style.removeProperty("transition");
            inner.style.removeProperty("transform");
          }
          inner.classList.add("is-pressed");
        };
        const moveDrag = (clientX, clientY, preventDefault) => {
          if (!active) return;
          const cx = clientX - sx, cy = clientY - sy;
          if (!axis) {
            if (Math.abs(cy) > Math.abs(cx) + 4) { axis = "y"; return; }
            if (Math.abs(cx) > 6) { axis = "x"; ensureActs(); }
          }
          if (axis !== "x") return;
          inner.classList.remove("is-pressed");
          inner.style.transition = "none";
          if (preventDefault) preventDefault();
          didSwipe = true;
          dx = cx;
          const base = (sr._snap || 0) * SNAP_W;
          let x = base + dx * 0.62;
          if (x > 0) x = 0;
          else if (x < minX) x = minX + (x - minX) * 0.14;
          inner.style.transform = x ? `translateX(${x}px)` : "";
          sr.classList.remove("swipe-settling");
          sr.style.setProperty("--swipe-p", SNAP_W ? (Math.min(1, Math.abs(x) / SNAP_W)).toFixed(3) : "0");
        };
        const endDrag = () => {
          inner.classList.remove("is-pressed");
          if (!active || axis !== "x") { active = false; return; }
          active = false;
          const base = (sr._snap || 0) * SNAP_W;
          const fx = base + dx;
          sr.classList.add("swipe-settling");
          if (fx < -THRESH && acts.length) {
            inner.style.transition = SNAP_EASE; inner.style.transform = `translateX(${-SNAP_W}px)`;
            sr._snap = -1; anyOpen = sr;
            sr.classList.add("swipe-open");
            sr.style.setProperty("--swipe-p", "1");
          } else {
            inner.style.transition = SNAP_EASE; inner.style.transform = "";
            sr._snap = 0; if (anyOpen === sr) anyOpen = null;
            sr.classList.remove("swipe-open");
            sr.style.setProperty("--swipe-p", "0");
          }
          dx = 0;
          inner.addEventListener("transitionend", () => { if (!sr._snap) removeSwipeActs(sr); }, { once: true });
        };
        inner.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          if (e.target.closest("a, button")) return;
          inner.setPointerCapture(e.pointerId);
          startDrag(e.clientX, e.clientY);
        });
        inner.addEventListener("pointermove", (e) => {
          moveDrag(e.clientX, e.clientY, () => {
            if (e.cancelable) e.preventDefault();
          });
        }, { passive: false });
        inner.addEventListener("pointerup", endDrag);
        inner.addEventListener("pointercancel", endDrag);
        inner.addEventListener("click", (e) => {
          if (didSwipe) { didSwipe = false; e.stopPropagation(); return; }
          if (sr._snap !== 0) { closeRow(sr, true); anyOpen = null; e.stopPropagation(); return; }
          if (e.target.closest(".swipe-act")) return;
          const href = inner.dataset.openHref;
          if (href) openSessionFrame(href, sr.dataset.sessionName || "");
        });
      };

      const renderRows = (active, archived) => {
        const rowKey = (row) => row.dataset.sessionName || "";
        const firstRects = captureListRowRects(wrap, ".swipe-row", rowKey);
        let html = "";
        if (active.length) {
          html += `<div class="mob-section-label">Active</div>`;
          html += active.map((s) => {
            const preview = s.latest_message_preview ? `<div class="mob-row-preview"><span class="sender">${esc(s.latest_message_sender || "latest")}</span> ${esc(s.latest_message_preview)}</div>` : "";
            return `<div class="swipe-row" data-session-name="${esc(s.name)}" data-swipe-right="kill">` +
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
            return `<div class="swipe-row" data-session-name="${esc(s.name)}" data-swipe-right="revive,delete-archived">` +
              `<div class="mob-session-row archived-row" data-session-name="${esc(s.name)}" data-open-href="/open-session?session=${encodeURIComponent(s.name)}" role="link" tabindex="0">` +
              `<div class="mob-row-head">` +
              `<div class="mob-row-name">${esc(s.name)}</div>` +
              `</div>` +
              preview +
              `</div></div>`;
          }).join("");
        }
        if (!active.length && !archived.length) {
          html += `<div class="mob-empty">No sessions found</div>`;
        }
        wrap.innerHTML = html;
        syncMobileSelectedSessionRows();
        wrap.querySelectorAll(".swipe-row").forEach(initSwipeRow);
        flipListRows(wrap, ".swipe-row", rowKey, firstRects);
      };
      const refresh = async (force) => {
        const requestSeq = ++_mobSessionsRequestSeq;
        try {
          const res = await fetch(`/sessions?ts=${Date.now()}`, { cache: "no-store" });
          if (!res.ok) throw new Error("failed");
          const data = await res.json();
          if (requestSeq !== _mobSessionsRequestSeq) return;
          if (data.hub_instance !== HUB_INSTANCE) {
            setResidentStatus("hub-restarted", "Hub restarted; reload");
          }
          const activeSessions = data.active_sessions;
          const archivedSessions = data.archived_sessions;
          _mobSessionsCache = { active: activeSessions, archived: archivedSessions };

          const sig = JSON.stringify({
            active: activeSessions,
            archived: archivedSessions,
          });
          if (!force && window._lastMobRenderSig === sig) {
            _mobSessionsRenderedOnce = true;
            releaseHubLaunchShellAfterRender();
            return;
          }
          window._lastMobRenderSig = sig;

          const rememberedName = lastRememberedSession();
          const launchSession = !_mobSessionsRenderedOnce && _restoreLatestSessionOnLaunch && !_currentRoomSessionName
            ? activeSessions.find((session) => session.name === rememberedName) || activeSessions[0]
            : null;
          renderRows(activeSessions, archivedSessions);
          _mobSessionsRenderedOnce = true;
          if (launchSession?.name) {
            void openSessionFrame(
              `/open-session?session=${encodeURIComponent(launchSession.name)}`,
              launchSession.name,
            ).finally(releaseHubLaunchShellAfterRender);
          } else {
            releaseHubLaunchShellAfterRender();
          }
        } catch (_) {
          if (requestSeq !== _mobSessionsRequestSeq) return;
          if (_mobSessionsRenderedOnce || _mobSessionsCache.active.length || _mobSessionsCache.archived.length) return;
          wrap.innerHTML = `<div class="mob-empty">Failed to load sessions</div>`;
          if (_hubLaunchShellPending) failHubReadyWait("Failed to load sessions");
        }
      };
      refreshMobSessions = refresh;
      startHubSessionMessagesEvents(() => refresh(true));
      refresh();
    })();

    (function () {
      var bridge = document.getElementById("pageNativeMenuBridge");
      var menuButton = document.getElementById("pageMenuBtn");
      if (bridge) {
        bridge.addEventListener("pointerdown", function (e) {
          if (!themeNativeMenuIsArmed()) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          skipThemeMenuBlur = false;
          showArmedThemeNativeMenu();
        });
        bridge.addEventListener("change", function (e) {
          var val = bridge.value;
          if (!val) return;
          if (val === "close-session" || val === "hub") {
            e.stopImmediatePropagation();
            bridge.value = "";
            closeRoomFrame();
          } else if (val === "theme") {
            e.stopImmediatePropagation();
            bridge.value = "";
            openThemeNativeMenu();
          }
        });
      }
      if (menuButton) {
        menuButton.addEventListener("click", function (e) {
          if (!themeNativeMenuIsArmed()) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          skipThemeMenuBlur = false;
          showArmedThemeNativeMenu();
        });
      }
      document.addEventListener("click", function () {
        if (skipThemeMenuBlur) setTimeout(function () { skipThemeMenuBlur = false; }, 0);
      });
    })();


    __HUB_HEADER_JS__
