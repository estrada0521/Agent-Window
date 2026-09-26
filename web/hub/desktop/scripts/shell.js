
    let _hubTimelinesCache = { active: [], archived: [] };
    let _deskPreviewRevisions = new Map();
    const _deskUnreadTimelines = new Set();
    let _deskTimelinesRequestSeq = 0;
    let _deskTimelinesRenderedOnce = false;
    let _deskSelectedTimelineName = "";
    let _deskTimelineFrameLoadedUrl = "";
    let _deskOpenToken = 0;
    let _deskSidebarWidthAtDefaultTextSize = DESK_DEFAULT_SIDEBAR_WIDTH_AT_DEFAULT_TEXT_SIZE;
    let _deskOpenSwipeRow = null;
    let _deskContextTimelineName = "";
    let _deskTimelineRename = null;
    let _deskNewTimelineStarting = false;

    function updateDeskWindowTitle(name) {
      const textEl = _deskTimelineTitleTextEl;
      if (!textEl) return;
      textEl.textContent = "";
      if (name) {
        textEl.textContent = name;
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
    function setDeskTimelineLoading(active) {
      if (!_deskTimelineShell) return;
      _deskTimelineShell.classList.toggle("loading", !!active);
    }
    function triggerDeskHubReload() {
      if (!_deskReloadBtn || _deskReloadBtn.classList.contains("restarting")) return;
      _deskReloadShell.hidden = false;
      _deskReloadShell.classList.add("visible");
      beginHubRestart(_deskReloadBtn);
    }
    function failDeskOpen(message) {
      clearDeskTimelineFrame();
      setResidentStatus("timeline-open", message);
      showDeskSidebarList({ open: true });
    }

    const { setStatus, setResidentStatus } = createHud(document.getElementById("hubHud"));

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

    function openDeskTimelineHeaderMenu() {
      const frameWin = _deskTimelineFrame?.contentWindow;
      if (!frameWin) return;
      const frameRect = _deskTimelineFrame?.getBoundingClientRect?.() || { left: 0, top: 0 };
      const btnRect = _deskTimelineMenuBtn?.getBoundingClientRect?.() || null;
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
      frameWin.postMessage({ type: "open-timeline-header-menu", anchor }, "*");
    }
    function sendDeskPanelCommand(mode) {
      const frameWin = _deskTimelineFrame?.contentWindow;
      if (!frameWin) return;
      frameWin.postMessage({ type: "desktop-panel", mode: String(mode || "") }, "*");
    }
    function sendDeskTimelineAction(action) {
      const frameWin = _deskTimelineFrame?.contentWindow;
      if (!frameWin) return;
      frameWin.postMessage({
        type: "native-menu-action",
        payload: { action: String(action || "") },
      }, "*");
    }

    function consumeHubPendingError() {
      const message = sessionStorage.getItem(HUB_PENDING_ERROR_KEY) || "";
      if (!message) return;
      sessionStorage.removeItem(HUB_PENDING_ERROR_KEY);
      setStatus(message);
    }

    function isPhoneViewport() {
      if (isNativeApp()) return false;
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
      return clampDeskSidebarWidthAtDefaultTextSize(localStorage.getItem(DESK_SIDEBAR_WIDTH_KEY));
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
        _deskAppSidebarToggle.classList.toggle("is-active", isDeskTimelineSidebarOpen());
      }
      if (persist) {
        localStorage.setItem(DESK_SIDEBAR_WIDTH_KEY, String(_deskSidebarWidthAtDefaultTextSize));
      }
    }

    function setDeskSidebarWidthFromRenderedPx(nextWidth) {
      const textSize = currentDeskTextSizePx();
      const widthAtDefaultTextSize = Number(nextWidth) * DESK_TEXT_SIZE_DEFAULT / textSize;
      setDeskSidebarWidthAtDefaultTextSize(widthAtDefaultTextSize);
    }

    const deskDtHasFiles = (dt) => !!(dt && Array.from(dt.types || []).includes("Files"));
    const isDeskTimelineFrameDropTarget = (target) => target === _deskTimelineFrame;
    const postDeskTimelineFrameMessage = (payload) => {
      try {
        _deskTimelineFrame?.contentWindow?.postMessage(payload, "*");
        return true;
      } catch (_) {
        return false;
      }
    };
    const setDeskAttachDragActive = (active) => {
      postDeskTimelineFrameMessage({ type: "parent-attach-drag", active: !!active });
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
      return postDeskTimelineFrameMessage({ type: "parent-drop-files", files: dropped });
    };
    function persistDeskSelection(name) {
      if (name) localStorage.setItem(DESK_SELECTED_KEY, name);
      else localStorage.removeItem(DESK_SELECTED_KEY);
    }

    function getPersistedDeskSelection() {
      return localStorage.getItem(DESK_SELECTED_KEY) || "";
    }

    function findTimelineRecord(name) {
      const active = (_hubTimelinesCache.active || []).find((timeline) => timeline.name === name);
      if (active) return { timeline: active, archived: false };
      const archived = (_hubTimelinesCache.archived || []).find((timeline) => timeline.name === name);
      if (archived) return { timeline: archived, archived: true };
      return null;
    }

    function buildTimelineOpenHref(timelineName, _archived) {
      return `/open-timeline?timeline=${encodeURIComponent(timelineName)}`;
    }

    function switchToDeskActiveTimeline(index) {
      const target = (_hubTimelinesCache.active || [])[index];
      if (!target || !target.name || target.name === _deskSelectedTimelineName) return;
      openTimelineFrame(buildTimelineOpenHref(target.name, false), target.name);
    }

    function systemPrefersDark() {
      try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (_) { return true; }
    }

    function deskTimelineThemeFromDesktop(themeDesktop) {
      const value = String(
        themeDesktop || document.documentElement.dataset.themeDesktop || document.documentElement.dataset.theme || "dark"
      ).trim().toLowerCase();
      if (value === "system") return systemPrefersDark() ? "dark" : "light";
      return value === "light" ? "light" : "dark";
    }

    function applyDeskTimelineTheme(themeDesktop) {
      const resolvedThemeDesktop = themeDesktop || document.documentElement.dataset.themeDesktop || document.documentElement.dataset.theme || "dark";
      const timelineTheme = deskTimelineThemeFromDesktop(resolvedThemeDesktop);
      _deskTimelineFrame?.contentWindow?.postMessage(
        { type: "hub-theme-changed", theme: timelineTheme, timelineTheme, themeDesktop: resolvedThemeDesktop },
        "*"
      );
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
      applyDeskTimelineTheme(themeDesktop);
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

    function buildDeskTimelineFrameUrl(timelineUrl) {
      const raw = String(timelineUrl || "").trim();
      if (!raw) return "";
      try {
        const parsed = new URL(raw, window.location.href);
        parsed.searchParams.set("hub_shell", "1");
        const themeDesktop = document.documentElement.dataset.themeDesktop || _deskAppearance.themeDefault;
        parsed.searchParams.set("theme", deskTimelineThemeFromDesktop(themeDesktop));
        parsed.searchParams.set("theme_desktop", themeDesktop);
        parsed.searchParams.set("text_size", String(currentDeskTextSizePx()));
        if (parsed.origin === window.location.origin) {
          return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
        return parsed.toString();
      } catch (_) {
        if (/[?&]hub_shell=/.test(raw)) return raw;
        let q = raw + (raw.includes("?") ? "&" : "?") + "hub_shell=1";
        return q;
      }
    }

    function cacheDeskTimelineUrl(cacheKey, timelineUrl) {
      hubTimelineUrls.write(cacheKey, timelineUrl);
    }

    function syncDeskTimelineShellState() {
      if (_deskTimelineFrame) {
        if (isDeskTimelineSidebarOpen()) _deskTimelineFrame.dataset.hubSidebarOpen = "1";
        else delete _deskTimelineFrame.dataset.hubSidebarOpen;
      }
    }

    function syncDeskSidebarResizerVisibility() {
      if (!_deskSidebarResizer) return;
      if (isNativeApp()) {
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
      sessionStorage.setItem(DESK_SIDEBAR_OPEN_KEY, isOpen ? "1" : "0");
      if (_deskAppSidebarToggle) {
        _deskAppSidebarToggle.classList.toggle("is-active", isDeskTimelineSidebarOpen());
      }
      syncDeskSidebarResizerVisibility();
      syncDeskTimelineShellState();
    }

    function isDeskSidebarOpen() {
      return !!(_deskWorkbench && _deskWorkbench.classList.contains("sidebar-open"));
    }

    function isDeskTimelineSidebarOpen() {
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
        if (_deskAutoWindowHeight) return;
        if (hoverPopover) return;
        if (!_deskTimelineList) return;

        const listEl = document.createElement("div");
        listEl.className = "desk-sidebar-hover-list";
        for (const child of Array.from(_deskTimelineList.children)) {
          if (child.classList.contains("desk-section-label")) {
            listEl.appendChild(child.cloneNode(true));
          } else if (child.classList.contains("desk-swipe-row")) {
            const row = child.querySelector(".desk-timeline-row");
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
          const row = event.target.closest(".desk-timeline-row");
          if (!row) return;
          const href = row.dataset.openHref;
          const name = row.dataset.timelineName || "";
          if (href) { dismiss(); openTimelineFrame(href, name); }
        });
        hoverPopover.appendChild(listEl);
        document.body.appendChild(hoverPopover);

        const wbRect = _deskWorkbench ? _deskWorkbench.getBoundingClientRect() : null;
        const gap = Math.round(10 * currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT);
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
