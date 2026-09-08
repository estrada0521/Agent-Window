
    let _hubSessionsCache = { active: [], archived: [] };
    let _deskPreviewRevisions = new Map();
    const _deskUnreadSessions = new Set();
    let _deskSessionsRequestSeq = 0;
    let _deskSessionsRenderedOnce = false;
    let _deskSelectedSessionName = "";
    let _deskChatFrameLoadedUrl = "";
    let _deskOpenToken = 0;
    let _deskSidebarWidthAtDefaultTextSize = DESK_DEFAULT_SIDEBAR_WIDTH_AT_DEFAULT_TEXT_SIZE;
    let _deskOpenSwipeRow = null;
    let _deskContextSessionName = "";
    let _deskSessionRename = null;
    let _deskNewSessionStarting = false;
    let _deskHubMessageTimer = 0;

    function updateDeskWindowTitle(name) {
      const textEl = _deskSessionTitleTextEl;
      if (!textEl) return;
      textEl.textContent = "";
      if (name) {
        const port = findSessionRecord(name)?.session?.chat_port;
        // Two spans so updateDeskChromeOverflow can drop just the "(port)"
        // suffix a step before hiding the whole label.
        const nameEl = document.createElement("span");
        nameEl.className = "desk-session-title-name";
        nameEl.textContent = name;
        const portEl = document.createElement("span");
        portEl.className = "desk-session-title-port";
        portEl.textContent = port ? ` (${port})` : "";
        textEl.append(nameEl, portEl);
      }
      updateDeskChromeOverflow();
    }
    function updateDeskPanelButtonState(mode = "", width = _deskPanelWidth) {
      _deskPanelActiveMode = mode ? "open" : "";
      const nextWidth = Math.max(0, Number(width) || 0);
      if (nextWidth > 0) _deskPanelWidth = nextWidth;
      if (_deskPanelToggle) {
        _deskPanelToggle.classList.toggle("active", !!_deskPanelActiveMode);
        _deskPanelToggle.setAttribute("aria-pressed", _deskPanelActiveMode ? "true" : "false");
      }
    }
    function setDeskChatLoading(active) {
      if (!_deskChatShell) return;
      _deskChatShell.classList.toggle("loading", !!active);
    }
    function setDeskReloadShell(active) {
      if (!_deskReloadShell) return;
      if (active) {
        const card = _deskReloadShell.querySelector(".desk-reload-shell-card");
        if (card) {
          card.classList.remove("is-error");
          card.innerHTML = '<span class="desk-reload-shell-spinner" aria-hidden="true"></span>';
        }
      }
      _deskReloadShell.hidden = !active;
      _deskReloadShell.classList.toggle("visible", !!active);
    }
    function triggerDeskHubReload() {
      if (!_deskReloadBtn || _deskReloadBtn.classList.contains("restarting")) return;
      setDeskReloadShell(true);
      beginHubRestart(_deskReloadBtn);
    }
    function failDeskOpen(message) {
      const card = _deskReloadShell?.querySelector(".desk-reload-shell-card");
      if (card) {
        card.classList.add("is-error");
        card.textContent = String(message || "open session failed");
      }
      if (_deskReloadShell) {
        _deskReloadShell.hidden = false;
        _deskReloadShell.classList.add("visible");
      }
      setDeskChatLoading(false);
      showDeskSidebarList({ open: true });
    }

    function showDeskHubMessage(message = "", { error = false } = {}) {
      if (!_deskHubMessage) return;
      window.clearTimeout(_deskHubMessageTimer);
      _deskHubMessageTimer = 0;
      const text = String(message || "").trim();
      _deskHubMessage.textContent = text;
      _deskHubMessage.classList.toggle("is-error", !!text && error);
      _deskHubMessage.hidden = !text;
      if (text) {
        _deskHubMessageTimer = window.setTimeout(() => {
          _deskHubMessage.textContent = "";
          _deskHubMessage.classList.remove("is-error");
          _deskHubMessage.hidden = true;
          _deskHubMessageTimer = 0;
        }, DESK_HUB_MESSAGE_VISIBLE_MS);
      }
    }

    async function copyDeskText(text) {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return;
        } catch (_) {}
      }
      const input = document.createElement("textarea");
      input.value = text;
      input.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(input);
      input.focus();
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) throw new Error("Clipboard is unavailable.");
    }

    function openDeskChatHeaderMenu() {
      const frameWin = _deskChatFrame?.contentWindow;
      if (!frameWin) return;
      const frameRect = _deskChatFrame?.getBoundingClientRect?.() || { left: 0, top: 0 };
      const btnRect = _deskChatMenuBtn?.getBoundingClientRect?.() || null;
      const anchor = btnRect
        ? {
            left: Number(btnRect.left || 0) - Number(frameRect.left || 0),
            top: Number(btnRect.top || 0) - Number(frameRect.top || 0),
            right: Number(btnRect.right || 0) - Number(frameRect.left || 0),
            bottom: Number(btnRect.bottom || 0) - Number(frameRect.top || 0),
            width: Number(btnRect.width || 24),
            height: Number(btnRect.height || 24),
          }
        : null;
      frameWin.postMessage({ type: "open-chat-header-menu", anchor }, "*");
    }
    function sendDeskPanelCommand(mode) {
      const frameWin = _deskChatFrame?.contentWindow;
      if (!frameWin) return;
      frameWin.postMessage({ type: "desktop-panel", mode: String(mode || "") }, "*");
    }
    function sendDeskChatAction(action) {
      const frameWin = _deskChatFrame?.contentWindow;
      if (!frameWin) return;
      frameWin.postMessage({
        type: "native-menu-action",
        payload: { action: String(action || "") },
      }, "*");
    }

    function consumeHubPendingError() {
      let message = "";
      try {
        message = String(sessionStorage.getItem(HUB_PENDING_ERROR_KEY) || "");
        if (message) sessionStorage.removeItem(HUB_PENDING_ERROR_KEY);
      } catch (_) {
        message = "";
      }
      if (!message) return;
      showDeskHubMessage(message, { error: true });
    }

    function isPhoneViewport() {
      if (isTauriDesktopApp()) return false;
      return !!_phoneViewportQuery.matches;
    }

    function activeTextEntryElement() {
      const active = document.activeElement;
      if (!active) return null;
      const tag = String(active.tagName || "").toUpperCase();
      if (tag === "TEXTAREA") return active;
      if (tag !== "INPUT") return null;
      const type = String(active.getAttribute("type") || active.type || "").toLowerCase();
      if (!type || ["text", "search", "email", "url", "tel", "number", "password"].includes(type)) {
        return active;
      }
      return null;
    }

    function syncAppShellHeight({ force = false } = {}) {
      if (!isPhoneViewport()) {
        document.documentElement.style.removeProperty("--app-shell-height");
        return;
      }
      const vv = window.visualViewport;
      let nextHeight = Math.round(window.innerHeight || 0);
      if (vv && vv.height > 0) {
        nextHeight = Math.round(vv.height + Math.max(0, vv.offsetTop || 0));
      }
      if (nextHeight <= 0) return;
      const prevHeight = parseInt(document.documentElement.style.getPropertyValue("--app-shell-height"), 10) || 0;
      if (!force && activeTextEntryElement() && prevHeight && nextHeight < prevHeight - 120) {
        return;
      }
      document.documentElement.style.setProperty("--app-shell-height", `${nextHeight}px`);
    }

    syncAppShellHeight({ force: true });
    if (typeof _phoneViewportQuery.addEventListener === "function") {
      _phoneViewportQuery.addEventListener("change", () => {
        syncAppShellHeight({ force: true });
        syncDeskSidebarResizerVisibility();
      });
    } else if (typeof _phoneViewportQuery.addListener === "function") {
      _phoneViewportQuery.addListener(() => {
        syncAppShellHeight({ force: true });
        syncDeskSidebarResizerVisibility();
      });
    }
    window.addEventListener("pageshow", () => syncAppShellHeight({ force: true }));
    window.addEventListener("resize", () => syncAppShellHeight());
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => syncAppShellHeight());
      window.visualViewport.addEventListener("scroll", () => syncAppShellHeight());
    }

    function roundDeskSidebarWidth(value) {
      return Math.round(value * 100) / 100;
    }

    function clampDeskSidebarWidthAtDefaultTextSize(value) {
      const numeric = Number(value);
      const width = Number.isFinite(numeric) ? numeric : DESK_DEFAULT_SIDEBAR_WIDTH_AT_DEFAULT_TEXT_SIZE;
      return roundDeskSidebarWidth(Math.max(
        DESK_MIN_SIDEBAR_WIDTH_AT_DEFAULT_TEXT_SIZE,
        Math.min(DESK_MAX_SIDEBAR_WIDTH_AT_DEFAULT_TEXT_SIZE, width),
      ));
    }

    function currentDeskSidebarWidthPx() {
      return roundDeskSidebarWidth(
        _deskSidebarWidthAtDefaultTextSize * currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT,
      );
    }

    function readDeskSidebarWidthAtDefaultTextSize() {
      try {
        return clampDeskSidebarWidthAtDefaultTextSize(localStorage.getItem(DESK_SIDEBAR_WIDTH_KEY));
      } catch (_) {
        return DESK_DEFAULT_SIDEBAR_WIDTH_AT_DEFAULT_TEXT_SIZE;
      }
    }

    function applyDeskSidebarWidth() {
      if (_deskWorkbench) {
        _deskWorkbench.style.setProperty("--desk-sidebar-width", `${currentDeskSidebarWidthPx()}px`);
      }
    }

    function setDeskSidebarWidthAtDefaultTextSize(nextWidth, { persist = true } = {}) {
      _deskSidebarWidthAtDefaultTextSize = clampDeskSidebarWidthAtDefaultTextSize(nextWidth);
      applyDeskSidebarWidth();
      if (_deskAppSidebarToggle) {
        _deskAppSidebarToggle.classList.toggle("is-active", isDeskSessionSidebarOpen());
      }
      if (persist) {
        try {
          localStorage.setItem(DESK_SIDEBAR_WIDTH_KEY, String(_deskSidebarWidthAtDefaultTextSize));
        } catch (_) {}
      }
    }

    function setDeskSidebarWidthFromRenderedPx(nextWidth) {
      const textSize = currentDeskTextSizePx();
      const widthAtDefaultTextSize = Number(nextWidth) * DESK_TEXT_SIZE_DEFAULT / textSize;
      setDeskSidebarWidthAtDefaultTextSize(widthAtDefaultTextSize);
    }

    const deskDtHasFiles = (dt) => !!(dt && Array.from(dt.types || []).includes("Files"));
    const isDeskChatFrameDropTarget = (target) => target === _deskChatFrame;
    const postDeskChatFrameMessage = (payload) => {
      try {
        _deskChatFrame?.contentWindow?.postMessage(payload, "*");
        return true;
      } catch (_) {
        return false;
      }
    };
    const setDeskAttachDragActive = (active) => {
      postDeskChatFrameMessage({ type: "parent-attach-drag", active: !!active });
    };
    let deskAttachDragClearTimer = 0;
    const showDeskAttachDrag = () => {
      if (deskAttachDragClearTimer) {
        clearTimeout(deskAttachDragClearTimer);
        deskAttachDragClearTimer = 0;
      }
      setDeskAttachDragActive(true);
    };
    const hideDeskAttachDrag = ({ immediate = false } = {}) => {
      if (deskAttachDragClearTimer) {
        clearTimeout(deskAttachDragClearTimer);
        deskAttachDragClearTimer = 0;
      }
      if (immediate) {
        setDeskAttachDragActive(false);
        return;
      }
      deskAttachDragClearTimer = setTimeout(() => {
        setDeskAttachDragActive(false);
        deskAttachDragClearTimer = 0;
      }, 120);
    };
    const forwardDeskDroppedFiles = (files) => {
      const dropped = Array.from(files || []).filter((file) => file && typeof file.name === "string");
      if (!dropped.length) return false;
      return postDeskChatFrameMessage({ type: "parent-drop-files", files: dropped });
    };
    function setDeskSelectionInUrl(name) {
      try {
        const next = new URL(window.location.href);
        if (name) next.searchParams.set("session", name);
        else next.searchParams.delete("session");
        history.replaceState(null, "", `${next.pathname}${next.search}${next.hash}`);
      } catch (_) {}
    }

    function persistDeskSelection(name) {
      try {
        if (name) localStorage.setItem(DESK_SELECTED_KEY, name);
        else localStorage.removeItem(DESK_SELECTED_KEY);
      } catch (_) {}
    }

    function getRequestedDeskSelection() {
      try {
        const queryName = new URL(window.location.href).searchParams.get("session");
        if (queryName) return queryName;
      } catch (_) {}
      try {
        return localStorage.getItem(DESK_SELECTED_KEY) || "";
      } catch (_) {
        return "";
      }
    }

    function findSessionRecord(name) {
      const active = (_hubSessionsCache.active || []).find((session) => session.name === name);
      if (active) return { session: active, archived: false };
      const archived = (_hubSessionsCache.archived || []).find((session) => session.name === name);
      if (archived) return { session: archived, archived: true };
      return null;
    }

    function buildSessionOpenHref(sessionName, _archived) {
      return `/open-session?session=${encodeURIComponent(sessionName)}`;
    }

    // ⌘1..⌘9 -> the 1st..9th active session (sidebar order). Capped at 9;
    // archived / warning sessions are not addressable this way.
    function switchToDeskActiveSession(index) {
      const target = (_hubSessionsCache.active || [])[index];
      if (!target || !target.name || target.name === _deskSelectedSessionName) return;
      openSessionFrame(buildSessionOpenHref(target.name, false), target.name);
    }

    function systemPrefersDark() {
      try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (_) { return true; }
    }

    function deskChatThemeFromDesktop(themeDesktop) {
      const value = String(
        themeDesktop || document.documentElement.dataset.themeDesktop || document.documentElement.dataset.theme || "dark"
      ).trim().toLowerCase();
      if (value === "system") return systemPrefersDark() ? "dark" : "light";
      return value === "light" ? "light" : "dark";
    }

    function applyDeskChatTheme(themeDesktop) {
      const resolvedThemeDesktop = themeDesktop || document.documentElement.dataset.themeDesktop || document.documentElement.dataset.theme || "dark";
      const chatTheme = deskChatThemeFromDesktop(resolvedThemeDesktop);
      try {
        _deskChatFrame?.contentWindow?.postMessage(
          { type: "hub-theme-changed", theme: chatTheme, chatTheme, themeDesktop: resolvedThemeDesktop },
          "*"
        );
      } catch (_) {}
    }

    function applyIncomingThemeDesktop(themeDesktopRaw) {
      const themeDesktop = String(
        themeDesktopRaw || document.documentElement.dataset.themeDesktop || "dark"
      ).trim().toLowerCase();
      const hubTheme = themeDesktop === "system"
        ? (systemPrefersDark() ? "dark" : "light")
        : (themeDesktop === "light" ? "light" : "dark");
      document.documentElement.dataset.theme = hubTheme;
      document.documentElement.dataset.themeDesktop = themeDesktop;
      applyDeskChatTheme(themeDesktop);
    }

    if ((document.documentElement.dataset.themeDesktop || "").trim().toLowerCase() === "system") {
      applyIncomingThemeDesktop("system");
    }
    try {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if ((document.documentElement.dataset.themeDesktop || "").trim().toLowerCase() === "system") {
          applyIncomingThemeDesktop("system");
        }
      });
    } catch (_) {}

    function buildDeskChatFrameUrl(chatUrl) {
      const raw = String(chatUrl || "").trim();
      if (!raw) return "";
      const isTauri = isTauriDesktopApp();
      try {
        const parsed = new URL(raw, window.location.href);
        parsed.searchParams.set("hub_shell", "1");
        const themeDesktop = document.documentElement.dataset.themeDesktop || _deskAppearance.themeDefault;
        parsed.searchParams.set("theme", deskChatThemeFromDesktop(themeDesktop));
        parsed.searchParams.set("theme_desktop", themeDesktop);
        parsed.searchParams.set("text_size", String(currentDeskTextSizePx()));
        if (isTauri) parsed.searchParams.set("tauri", "1");
        if (parsed.origin === window.location.origin) {
          return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
        return parsed.toString();
      } catch (_) {
        if (/[?&]hub_shell=/.test(raw)) return raw;
        let q = raw + (raw.includes("?") ? "&" : "?") + "hub_shell=1";
        if (isTauri) q += "&tauri=1";
        return q;
      }
    }

    window.__agentWindowRefreshTauriFrames = () => {
      if (!isTauriDesktopApp()) return;
      if (!_deskChatFrame) return;
      const current = _deskChatFrameLoadedUrl || String(_deskChatFrame.getAttribute("src") || _deskChatFrame.src || "");
      if (!current || current === "about:blank") return;
      const next = buildDeskChatFrameUrl(current);
      if (next && normalizeComparableUrl(current) !== normalizeComparableUrl(next)) {
        navigateDeskChatFrame(next);
      }
    };

    function cacheDeskChatUrl(cacheKey, chatUrl) {
      hubChatUrls.write(cacheKey, chatUrl);
    }

    function syncDeskChatShellState() {
      if (_deskChatFrame) {
        if (isDeskSessionSidebarOpen()) _deskChatFrame.dataset.hubSidebarOpen = "1";
        else delete _deskChatFrame.dataset.hubSidebarOpen;
      }
      try {
        _deskChatFrame?.contentWindow?.postMessage({
          type: "hub-sidebar-state",
          open: !!isDeskSessionSidebarOpen(),
        }, "*");
      } catch (_) {}
    }

    function syncDeskSidebarResizerVisibility() {
      if (!_deskSidebarResizer) return;
      if (isTauriDesktopApp()) {
        _deskSidebarResizer.hidden = !isDeskSidebarOpen();
        return;
      }
      if (isPhoneViewport()) {
        _deskSidebarResizer.hidden = true;
        return;
      }
      _deskSidebarResizer.hidden = !isDeskSidebarOpen();
    }

    function setDeskSidebarOpen(isOpen) {
      if (!_deskWorkbench) return;
      _deskWorkbench.classList.toggle("sidebar-open", !!isOpen);
      try { sessionStorage.setItem(DESK_SIDEBAR_OPEN_KEY, isOpen ? "1" : "0"); } catch (_) {}
      if (_deskAppSidebarToggle) {
        _deskAppSidebarToggle.classList.toggle("is-active", isDeskSessionSidebarOpen());
      }
      syncDeskSidebarResizerVisibility();
      syncDeskChatShellState();
    }

    function isDeskSidebarOpen() {
      return !!(_deskWorkbench && _deskWorkbench.classList.contains("sidebar-open"));
    }

    function isDeskSessionSidebarOpen() {
      return isDeskSidebarOpen();
    }

    function showDeskSidebarList({ open = true } = {}) {
      if (open) setDeskSidebarOpen(true);
    }

    function initDeskSidebarHoverPopover() {
      if (!_deskAppSidebarToggle) return;

      let hoverPopover = null;
      let dismissTimer = null;

      function cancelDismiss() {
        if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
      }

      function dismiss() {
        cancelDismiss();
        if (hoverPopover) { hoverPopover.remove(); hoverPopover = null; }
      }

      function scheduleDismiss() {
        cancelDismiss();
        dismissTimer = setTimeout(dismiss, 60);
      }

      function animatePopoverIn(popover) {
        if (!popover || typeof popover.animate !== "function") return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

        const frames = [];
        const steps = 48;
        const frequency = Math.PI * 2.55;
        const damping = 3.8;
        for (let i = 0; i <= steps; i += 1) {
          const progress = i / steps;
          const decay = Math.exp(-damping * progress);
          const wave = Math.sin((frequency * progress) - (Math.PI / 2));
          const opacity = Math.sin((Math.PI / 2) * Math.min(1, progress / 0.42));
          let scaleX = 1 + (0.14 * decay * wave);
          let scaleY = 1 + (0.20 * decay * wave);
          if (i === steps) {
            scaleX = 1;
            scaleY = 1;
          }
          frames.push({
            opacity: String(opacity),
            transform: `scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`,
          });
        }
        const animation = popover.animate(frames, {
          duration: 360,
          easing: "linear",
          fill: "both",
        });
        animation.addEventListener("finish", () => {
          popover.style.opacity = "";
          popover.style.transform = "";
        }, { once: true });
      }

      function open() {
        cancelDismiss();
        if (isDeskSidebarOpen()) return;
        if (_deskAutoWindowHeight) return; // this mode switches sessions via a native menu on click
        if (hoverPopover) return;
        if (!_deskSessionList) return;

        const listEl = document.createElement("div");
        listEl.className = "desk-sidebar-hover-list";
        for (const child of Array.from(_deskSessionList.children)) {
          if (child.classList.contains("desk-section-label")) {
            listEl.appendChild(child.cloneNode(true));
          } else if (child.classList.contains("desk-swipe-row")) {
            const row = child.querySelector(".desk-session-row");
            if (row) {
              const clone = row.cloneNode(true);
              clone.querySelectorAll(".desk-row-hover-action").forEach(b => b.remove());
              listEl.appendChild(clone);
            }
          }
        }
        if (!listEl.children.length) return;

        hoverPopover = document.createElement("div");
        hoverPopover.className = "desk-sidebar-hover-popover";
        hoverPopover.addEventListener("mouseenter", cancelDismiss);
        hoverPopover.addEventListener("mouseleave", scheduleDismiss);
        hoverPopover.addEventListener("click", (event) => {
          const row = event.target.closest(".desk-session-row");
          if (!row) return;
          const href = row.dataset.openHref;
          const name = row.dataset.sessionName || "";
          if (href) { dismiss(); openSessionFrame(href, name); }
        });
        hoverPopover.appendChild(listEl);
        document.body.appendChild(hoverPopover);

        const wbRect = _deskWorkbench ? _deskWorkbench.getBoundingClientRect() : null;
        const gap = 10;
        hoverPopover.style.top = `${Math.round((wbRect ? wbRect.top : _deskAppSidebarToggle.getBoundingClientRect().bottom) + gap)}px`;
        hoverPopover.style.left = `${Math.round((wbRect ? wbRect.left : 0) + gap)}px`;
        animatePopoverIn(hoverPopover);

        const updatePopoverFade = () => {
          listEl.dataset.scrollFade = computeScrollFadeState(listEl);
        };
        updatePopoverFade();
        listEl.addEventListener("scroll", updatePopoverFade, { passive: true });
      }

      _deskAppSidebarToggle.addEventListener("mouseenter", open);
      _deskAppSidebarToggle.addEventListener("mouseleave", scheduleDismiss);

      if (_deskWorkbench) {
        new MutationObserver(() => {
          if (isDeskSidebarOpen()) dismiss();
        }).observe(_deskWorkbench, { attributes: true, attributeFilter: ["class"] });
      }
    }
