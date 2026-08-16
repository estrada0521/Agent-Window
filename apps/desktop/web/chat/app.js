__CHAT_INCLUDE:../../../shared/chat/base.js__
    const fileViewHrefForPath = (path, { embed = false } = {}) => {
      const params = new URLSearchParams();
      params.set("path", normalizeWorkspaceFilePath(path) || String(path || "").trim());
      if (embed) { params.set("embed", "1"); params.set("pane", "1"); }
      if (embed) params.set("chrome", "header");
      params.set("agent_font_mode", currentFilePreviewFontMode());
      if (CHAT_BASE_PATH) params.set("base_path", CHAT_BASE_PATH);
      params.set("base_theme", document.documentElement.dataset.theme === "light" ? "light" : "dark");
      params.set("preview_variant", "desktop");
      const textSize = currentFilePreviewTextSize();
      if (textSize) params.set("agent_text_size", textSize);
      return withChatBase(`/file-view?${params.toString()}`);
    };
    const buildInlineFileLinkMarkup = (path, label = "") => {
      const normalizedPath = normalizeWorkspaceFilePath(path);
      if (!normalizedPath) return "";
      const visible = String(label || displayAttachmentFilename(normalizedPath) || normalizedPath).trim() || normalizedPath;
      const href = fileViewHrefForPath(normalizedPath);
      return `<a class="inline-file-link" href="${escapeHtml(href)}" data-filepath="${escapeHtml(normalizedPath)}" data-ext="${escapeHtml(extFromPath(normalizedPath))}" title="${escapeHtml(normalizedPath)}"><code>${escapeHtml(visible)}</code></a>`;
    };
    const injectFileCards = (html) => {
      return html
        .replace(/\[Attached:\s*([^\]]+)\]/g, (match, rawPath) => buildInlineFileLinkMarkup(rawPath.trim()))
        .replace(/(^|[\s>(])@((?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?)/g, (match, prefix, rawPath) => {
          return `${prefix}${buildInlineFileLinkMarkup(rawPath, rawPath)}`;
        });
    };
    const _pageParams = new URLSearchParams(window.location.search);
    const launchShellMode = _pageParams.get("launch_shell") === "1";
    const DESKTOP_FILE_PANE_MIN_VIEWPORT_PX = 961;
    let _scrollbarLayoutSyncFrame = 0;
    const syncChatScrollbarLayoutWidth = () => {
      const mainEl = document.querySelector("main");
      if (!mainEl || document.documentElement.dataset.mobile === "1") return;
      const width = Math.max(0, mainEl.offsetWidth - mainEl.clientWidth);
      const next = `${width}px`;
      if (mainEl.style.getPropertyValue("--chat-scrollbar-layout-width") !== next) {
        mainEl.style.setProperty("--chat-scrollbar-layout-width", next);
      }
    };
    const scheduleChatScrollbarLayoutWidthSync = () => {
      if (_scrollbarLayoutSyncFrame) return;
      _scrollbarLayoutSyncFrame = requestAnimationFrame(() => {
        _scrollbarLayoutSyncFrame = 0;
        syncChatScrollbarLayoutWidth();
      });
    };
    const mainScrollbarEl = document.querySelector("main");
    if (mainScrollbarEl && typeof ResizeObserver === "function") {
      new ResizeObserver(scheduleChatScrollbarLayoutWidthSync).observe(mainScrollbarEl);
    }
    const syncMainAfterHeight = () => {
      const mainEl = document.querySelector("main");
      if (!mainEl) return;
      mainEl.style.removeProperty("--main-spacer-height");
      mainEl.style.removeProperty("--main-after-height");
    };
    const syncAppShellHeight = () => {
      document.documentElement.style.removeProperty("--app-shell-height");
      document.documentElement.style.removeProperty("--mobile-overlay-lock-height");
      syncMainAfterHeight();
    };
    syncAppShellHeight();
    scheduleChatScrollbarLayoutWidthSync();
    window.addEventListener("pageshow", () => syncAppShellHeight());
    window.addEventListener("resize", () => {
      syncAppShellHeight();
      scheduleChatScrollbarLayoutWidthSync();
    });
    if (window.visualViewport) {
      let _vvSyncTimer = 0;
      const scheduleSyncFromVV = () => {
        if (_vvSyncTimer) clearTimeout(_vvSyncTimer);
        _vvSyncTimer = setTimeout(() => { _vvSyncTimer = 0; syncAppShellHeight(); }, 200);
      };
      window.visualViewport.addEventListener("resize", scheduleSyncFromVV);
      window.visualViewport.addEventListener("scroll", scheduleSyncFromVV);
    }
    let refreshInFlight = false;
    let pendingRefreshOptions = null;
    let reloadInFlight = false;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const AGENT_ICON_DATA = __ICON_DATA_URIS__;
    const SERVER_INSTANCE_SEED = "__SERVER_INSTANCE__";
    let currentServerInstance = SERVER_INSTANCE_SEED;
    const isPublicChatView = !(() => {
      const host = String(location.hostname || "");
      return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host.startsWith("192.168.") || host.startsWith("10.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    })();
    const MESSAGE_BATCH = 50;
    const INITIAL_MESSAGE_WINDOW = 50;
    let latestPayloadData = null;
    let olderEntries = [];
    let olderHasMore = false;
    let olderLoading = false;
    let publicFullEntryCache = new Map();
    let publicDeferredLoading = new Set();
    let publicDeferredObserver = null;
    let hasInitialRefreshHydrated = false;
__CHAT_INCLUDE:../../../shared/chat/launch-shell-gate.js__
    if (launchShellMode) {
      armLaunchShellGate();
    }
    let _pollScrollLockTop = null;
    let _pollScrollAnchor = null;
    let _hubIframeLayoutMaxH = 0;
    let _hubIframeLayoutFromParent = 0;
    let _hubChromeGapClientMin = Infinity;
    let _hubChildOriW = 0;
    let _hubChildOriH = 0;
    const isHubIframeChat = () =>
      document.documentElement.dataset.hubIframeChat === "1" ||
      document.documentElement.dataset.hubShell === "1" ||
      !!window.frameElement;
    const applyHubIframeLockHeight = () => {
      if (!isHubIframeChat()) return;
      const local = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
      _hubIframeLayoutMaxH = Math.max(_hubIframeLayoutMaxH, local);
      const h = Math.max(_hubIframeLayoutMaxH, _hubIframeLayoutFromParent);
      if (h > 0) {
        document.documentElement.style.setProperty("--hub-iframe-lock-height", h + "px");
      }
    };
    const bumpHubIframeLayoutLock = () => {
      if (!isHubIframeChat()) return;
      applyHubIframeLockHeight();
    };
    const requestHubParentLayout = () => {
      if (!isHubIframeChat()) return;
      try {
        window.parent.postMessage({ type: "chat-request-hub-layout" }, "*");
      } catch (_) {}
    };
    const notifyHubChatRenderReady = () => {
      if (!isHubIframeChat()) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            window.parent.postMessage({ type: "chat-render-ready" }, "*");
          } catch (_) {}
        });
      });
    };
    const notifyHubChatRenderError = (message) => {
      if (!isHubIframeChat()) return;
      window.parent.postMessage({ type: "chat-render-error", message: String(message || "render failed") }, "*");
    };
    if (isHubIframeChat()) {
      document.documentElement.dataset.hubIframeChat = "1";
      _hubChildOriW = window.innerWidth || 0;
      _hubChildOriH = window.innerHeight || 0;
      window.addEventListener("message", (e) => {
        if (!e.data || e.data.type !== "hub-layout") return;
        if (e.source !== window.parent) return;
        const lh = Number(e.data.layoutHeight) || 0;
        if (lh > 0) {
          _hubIframeLayoutFromParent = lh;
          applyHubIframeLockHeight();
        }
        const pih = Number(e.data.parentInnerHeight);
        const pvh = Number(e.data.parentVvHeight);
        const pvTop = Number(e.data.parentVvOffsetTop);
        const pcg = e.data.parentChromeGap;
        if (pih > 0 && pvh >= 0) {
          const top = Number.isFinite(pvTop) ? pvTop : 0;
          const fallbackRaw = Math.max(0, Math.round(pih - top - pvh));
          const incoming =
            typeof pcg === "number" && Number.isFinite(pcg) && pcg >= 0 ? pcg : fallbackRaw;
          if (incoming < 150) {
            _hubChromeGapClientMin = Math.min(_hubChromeGapClientMin, incoming);
          }
          const effective = incoming >= 150 ? incoming : _hubChromeGapClientMin;
          document.documentElement.style.setProperty(
            "--hub-parent-chrome-gap",
            (effective === Infinity ? incoming : effective) + "px",
          );
        }
      });
      __CHAT_INCLUDE:../../../shared/chat/hub-safari-chrome.js__
      bumpHubIframeLayoutLock();
      window.addEventListener("resize", hubChildResizeChrome, { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", hubChildResizeChrome);
        window.visualViewport.addEventListener("scroll", () => {
          bumpHubIframeLayoutLock();
          hubPingParentForSafariChrome();
        });
      }
      timeline.addEventListener("scroll", hubPingParentForSafariChrome, { passive: true });
      requestHubParentLayout();
    }
    const scrollConversationToBottom = (behavior = "auto") => {
      _programmaticScroll = true;
      timeline.scrollTo({ top: timeline.scrollHeight, behavior });
      requestAnimationFrame(() => { _programmaticScroll = false; });
    };
    const focusMessageInputWithoutScroll = (selectionStart = null, selectionEnd = selectionStart) => {
      if (typeof isComposerOverlayOpen === "function" && typeof openComposerOverlay === "function" && !isComposerOverlayOpen()) {
        openComposerOverlay({ immediateFocus: true });
        if (selectionStart !== null && typeof messageInput.setSelectionRange === "function") {
          requestAnimationFrame(() => {
            try {
              messageInput.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
            } catch (_) {}
          });
        }
        return;
      }
      try {
        messageInput.focus({ preventScroll: true });
      } catch (_) {
        messageInput.focus();
      }
      if (selectionStart !== null && typeof messageInput.setSelectionRange === "function") {
        try {
          messageInput.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
        } catch (_) {}
      }
    };
__CHAT_INCLUDE:attachments/file-open.js__
__CHAT_INCLUDE:../../../shared/chat/composer-overlay.js__
    const updateScrollBtnPos = () => {
      const shell = document.querySelector(".shell");
      shell.style.setProperty("--floating-btn-bottom", "160px");
      shell.style.setProperty("--composer-height", "0px");
    };
    const mathRenderOptions = {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false},
        {left: '\\[', right: '\\]', display: true},
        {left: '\\(', right: '\\)', display: false}
      ],
      ignoredClasses: ["no-math"],
      throwOnError: false
    };
__CHAT_INCLUDE:../../../shared/chat/transcript/rich-rendering.js__
    let selectedTargets = [];
    let sendLocked = false;
    let sessionActive = true;
    const canComposeInSession = () => !!sessionActive;
    let pendingAttachments = [];
    let availableTargets = [];
    let currentSessionName = "";
    let _renderedIds = new Set();
    const MESSAGE_COLLAPSE_LINES = 40;
    const expandedMessageBodies = new Set();
    const isCollapsibleMessageSender = (sender) => {
      const normalized = String(sender || "").trim().toLowerCase();
      return !!normalized && normalized !== "system";
    };
    const isCollapsibleMessageRow = (row) =>
      !!(row && row.classList?.contains("message-row") && isCollapsibleMessageSender(row.dataset?.sender));
    const syncMessageCollapse = (scope = document) => {
      const rows = scope?.matches?.("article.message-row")
        ? (isCollapsibleMessageRow(scope) ? [scope] : [])
        : Array.from(scope?.querySelectorAll?.("article.message-row") || []).filter(isCollapsibleMessageRow);
      rows.forEach((row) => {
        const bodyRow = row.querySelector(".message-body-row");
        const body = row.querySelector(".md-body");
        const toggle = row.querySelector(".message-collapse-toggle");
        if (!bodyRow || !body || !toggle) return;
        const style = getComputedStyle(body);
        const lineHeight = Number.parseFloat(style.lineHeight);
        const paddingTop = Number.parseFloat(style.paddingTop) || 0;
        const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
        if (!Number.isFinite(lineHeight)) {
          bodyRow.style.removeProperty("--message-collapse-max-height");
          row.classList.remove("is-collapsible");
          bodyRow.classList.remove("is-collapsed");
          toggle.classList.remove("is-visible");
          toggle.hidden = true;
          return;
        }
        const maxHeight = Math.ceil((lineHeight * MESSAGE_COLLAPSE_LINES) + paddingTop + paddingBottom);
        bodyRow.style.setProperty("--message-collapse-max-height", `${maxHeight}px`);
        const shouldCollapse = body.scrollHeight > (maxHeight + 4);
        const msgId = row.dataset.msgid || "";
        const isExpanded = shouldCollapse && msgId && expandedMessageBodies.has(msgId);
        row.classList.toggle("is-collapsible", shouldCollapse);
        bodyRow.classList.toggle("is-collapsed", shouldCollapse && !isExpanded);
        const showMoreBtn = shouldCollapse && !isExpanded;
        toggle.classList.toggle("is-visible", showMoreBtn);
        toggle.hidden = !showMoreBtn;
        toggle.textContent = "More";
      });
    };
    const escapeHtml = (value) => value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    const emptyConversationHTML = () => {
      return `<div class="conversation-empty" aria-hidden="true"></div>`;
    };
    const stripSenderPrefix = (value) => value.replace(/^\[From:\s*[^\]]+\]\s*/i, "");
    const normalizedSessionTargets = (rawTargets) => {
      return Array.isArray(rawTargets)
        ? rawTargets.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
        : [];
    };
__CHAT_INCLUDE:target-picker.js__
    const setQuickActionsDisabled = (disabled) => {
      document.querySelectorAll(".quick-action").forEach((node) => {
        node.disabled = disabled;
      });
    };
    const STICKY_THRESHOLD = 32;
    const OLDER_AUTOLOAD_MIN_THRESHOLD = 480;
    let _stickyToBottom = false;
    let _programmaticScroll = false;
    let _pollScrollRestoreRaf = 0;
    const maybeRestorePollScrollLock = () => {
      if (_programmaticScroll) return;
      const hasAnchor = _pollScrollAnchor && _pollScrollAnchor.msgId;
      const hasLock = _pollScrollLockTop != null;
      if (!hasAnchor && !hasLock) return;

      if (hasAnchor) {
        const row = timeline.querySelector(`[data-msgid="${CSS.escape(String(_pollScrollAnchor.msgId))}"]`);
        if (row) {
          const tRect = timeline.getBoundingClientRect();
          const drift = (row.getBoundingClientRect().top - tRect.top) - _pollScrollAnchor.vpTop;
          if (Math.abs(drift) > 0.5) {
            _programmaticScroll = true;
            timeline.scrollTop += drift;
            const maxTop = Math.max(0, timeline.scrollHeight - timeline.clientHeight);
            timeline.scrollTop = Math.min(Math.max(0, timeline.scrollTop), maxTop);
            _pollScrollLockTop = timeline.scrollTop;
            queueMicrotask(() => { _programmaticScroll = false; });
            return;
          }
        }
      }
      if (!hasLock) return;
      const maxTop = Math.max(0, timeline.scrollHeight - timeline.clientHeight);
      const target = Math.min(_pollScrollLockTop, maxTop);
      if (Math.abs(timeline.scrollTop - target) > 0.5) {
        _programmaticScroll = true;
        timeline.scrollTop = target;
        queueMicrotask(() => { _programmaticScroll = false; });
      }
    };
    const schedulePollScrollRestore = () => {
      if (_pollScrollLockTop == null && !(_pollScrollAnchor && _pollScrollAnchor.msgId)) return;
      if (_pollScrollRestoreRaf) return;
      _pollScrollRestoreRaf = requestAnimationFrame(() => {
        _pollScrollRestoreRaf = 0;
        maybeRestorePollScrollLock();
      });
    };
    if (typeof MutationObserver === "function") {
      try {
        new MutationObserver(() => schedulePollScrollRestore()).observe(timeline, {
          childList: true,
          subtree: true,
        });
      } catch (_) {}
    }
    const settleScrollLockFrames = (remaining) => {
      if (remaining <= 0) return;
      maybeRestorePollScrollLock();
      requestAnimationFrame(() => settleScrollLockFrames(remaining - 1));
    };
    const isNearBottom = () => {
      return timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < STICKY_THRESHOLD;
    };
    const updateStickyState = () => {
      if (_programmaticScroll) return;
      _stickyToBottom = isNearBottom();
    };
    const clearPollScrollLock = () => {
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
    };
    timeline.addEventListener("wheel", clearPollScrollLock, { passive: true });
    timeline.addEventListener("touchstart", clearPollScrollLock, { passive: true });
    timeline.addEventListener("scroll", updateStickyState, { passive: true });
    timeline.addEventListener("scroll", () => {
      if (olderLoading || !olderHasMore) return;
      const threshold = Math.max(OLDER_AUTOLOAD_MIN_THRESHOLD, timeline.clientHeight * 1.25);
      if (timeline.scrollTop > threshold) return;
      void loadOlderMessages();
    }, { passive: true });
    const updateScrollBtn = () => {
      if (!hasInitialRefreshHydrated) {
        scrollToBottomBtn.classList.remove("visible");
        composerFabBtn?.classList.remove("visible");
        return;
      }
      const overlayOpen = isComposerOverlayOpen();
      const emptyPlaceholder = !!document.querySelector("#messages .conversation-empty");
      scrollToBottomBtn.classList.toggle("visible", !_stickyToBottom && !overlayOpen && !emptyPlaceholder);
      composerFabBtn?.classList.toggle("visible", (_stickyToBottom || emptyPlaceholder) && !overlayOpen);
    };
    let centeredRowRaf = 0;
    const updateCenteredMessageRow = () => {
      const rows = Array.from(document.querySelectorAll("#messages article.message-row"));
      rows.forEach((row) => row.classList.remove("is-centered"));
      const useCenterHighlight = window.matchMedia("(hover: none), (pointer: coarse)").matches;
      if (!useCenterHighlight || !rows.length) return;
      const timelineRect = timeline.getBoundingClientRect();
      const centerY = timelineRect.top + (timelineRect.height / 2);
      let bestRow = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      rows.forEach((row) => {
        const rect = row.getBoundingClientRect();
        if (rect.bottom <= timelineRect.top || rect.top >= timelineRect.bottom) return;
        const rowCenter = rect.top + (rect.height / 2);
        const distance = Math.abs(rowCenter - centerY);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestRow = row;
        }
      });
      bestRow?.classList.add("is-centered");
    };
    const requestCenteredMessageRowUpdate = () => {
      if (centeredRowRaf) return;
      centeredRowRaf = requestAnimationFrame(() => {
        centeredRowRaf = 0;
        updateCenteredMessageRow();
      });
    };
    const flashHeaderToggle = (targetNode) => {
      const nodes = targetNode ? [targetNode] : document.querySelectorAll("#rightMenuBtn");
      nodes.forEach((node) => {
        if (node.classList.contains("animating")) return;
        node.classList.add("animating");
        setTimeout(() => {
          node.classList.remove("animating");
        }, 500);
      });
    };
    document.addEventListener("pointerdown", (e) => {
      const toggle = e.target.closest(".hub-page-menu-btn, .composer-attach-btn, .quick-action");
      if (toggle) {
        if (toggle.classList.contains("animating")) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        flashHeaderToggle(toggle);
      }
    });
__CHAT_INCLUDE:../../../shared/chat/target-selection.js__
    timeline.addEventListener("scroll", updateScrollBtn, { passive: true });
    timeline.addEventListener("scroll", requestCenteredMessageRowUpdate, { passive: true });
    window.addEventListener("resize", requestCenteredMessageRowUpdate);

    {
      const header = document.querySelector(".hub-page-header");
      if (header) header.classList.remove("header-hidden");
      timeline.addEventListener("scroll", () => {
        if (header?.classList.contains("header-hidden")) {
          header.classList.remove("header-hidden");
        }
      }, { passive: true });
    }

__CHAT_INCLUDE:../../../shared/chat/runtime/messages.js__
__CHAT_INCLUDE:../../../shared/chat/transcript/render.js__
__CHAT_INCLUDE:../../../shared/chat/transcript/actions.js__
__CHAT_INCLUDE:runtime/hub-navigation.js__
__CHAT_INCLUDE:panes/header-menu.js__
__CHAT_INCLUDE:panes/right-pane.js__
__CHAT_INCLUDE:composer/runtime.js__
__CHAT_INCLUDE:../../../shared/chat/attachments/file-runtime.js__
__CHAT_INCLUDE:../../../shared/chat/composer/commands.js__
__CHAT_INCLUDE:../../../shared/chat/thinking.js__
__CHAT_INCLUDE:../../../shared/chat/runtime/agent-status.js__
__CHAT_INCLUDE:../../../shared/chat/touch-interaction.js__
__CHAT_INCLUDE:../../../shared/chat/runtime/settings-sync.js__
    const desktopRightPanel = document.getElementById("desktopRightPanel");
    const desktopRightPanelResizer = document.getElementById("desktopRightPanelResizer");
    const dpSplitPanel = document.getElementById("dpSplitPanel");
    const dpSplitDivider = document.getElementById("dpSplitDivider");
    const dpRepoContent = document.getElementById("dpRepoContent");
    const dpGitContent = document.getElementById("dpGitContent");
    const DP_PANEL_DEFAULT_WIDTH = 220;
    const DP_PANEL_MIN_WIDTH = 220;
    const DP_PANEL_MAX_WIDTH = 560;
    const DP_PANEL_WIDTH_KEY = "agent_window_desktop_right_panel_width_px";
    const DP_PANEL_GAP = 0;
    const hasDesktopRightPanelOverlay = () => (
      document.documentElement.dataset.tauriApp === "1"
      && document.documentElement.dataset.hubIframeChat === "1"
      && document.documentElement.dataset.mobile !== "1"
    );
    let dpPanelOpen = false;
    let dpActivePanelView = "repo";
    let dpRepoBrowserPath = "";
    let dpRepoBrowserNavDirection = "forward";
    let dpPanelWidthPx = DP_PANEL_DEFAULT_WIDTH;
    let _desktopRightPanelResizeState = null;
    let _dpSplitDragging = false;
    let _dpSplitGitHeightPx = null;
    const dpClampPanelWidthPx = (value) => {
      const viewportWidth = Math.max(0, window.innerWidth || 0);
      const availableWidth = viewportWidth;
      const maxWidth = Math.max(DP_PANEL_MIN_WIDTH, Math.min(DP_PANEL_MAX_WIDTH, availableWidth - 360));
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return Math.max(DP_PANEL_MIN_WIDTH, Math.min(DP_PANEL_DEFAULT_WIDTH, maxWidth));
      }
      return Math.max(DP_PANEL_MIN_WIDTH, Math.min(maxWidth, Math.round(numeric)));
    };
    try {
      const storedPanelWidth = Number.parseInt(window.localStorage?.getItem(DP_PANEL_WIDTH_KEY) || "", 10);
      if (Number.isFinite(storedPanelWidth) && storedPanelWidth > 0) {
        dpPanelWidthPx = storedPanelWidth;
      }
    } catch (_) {}
    const dpPersistPanelWidthPx = () => {
      try {
        if (dpPanelWidthPx > 0) {
          window.localStorage?.setItem(DP_PANEL_WIDTH_KEY, String(dpPanelWidthPx));
        }
      } catch (_) {}
    };
    const dpCurrentPanelWidthPx = () => dpClampPanelWidthPx(dpPanelWidthPx || DP_PANEL_DEFAULT_WIDTH);
    const dpApplyPanelWidth = () => {
      dpPanelWidthPx = dpCurrentPanelWidthPx();
      const panelWidth = hasDesktopRightPanelOverlay() && dpPanelOpen ? dpPanelWidthPx : 0;
      document.documentElement.style.setProperty("--desktop-right-panel-width", `${panelWidth}px`);
      document.documentElement.style.setProperty("--desktop-right-panel-reserved-width", `${panelWidth > 0 ? panelWidth + DP_PANEL_GAP : 0}px`);
    };
__CHAT_INCLUDE:features/git-panel/panel.js__
    const notifyParentPanelState = () => {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: "desktop-panel-state",
            mode: dpPanelOpen ? "open" : "",
            view: dpActivePanelView,
            width: dpPanelOpen ? dpCurrentPanelWidthPx() : 0,
          }, "*");
        }
      } catch (_) {}
    };
    const setDesktopRightPanelView = (view) => {
      dpActivePanelView = view === "git" ? "git" : "repo";
      return dpActivePanelView;
    };
    const loadDesktopRightPanelView = ({ reset = false, animateRepo = true } = {}) => {
      if (!dpPanelOpen) return Promise.resolve();
      const gitP = dpLoadGitBranchPage({ reset: true });
      dpLoadRepoDir(dpRepoBrowserPath || "", { animate: animateRepo });
      return Promise.resolve(gitP);
    };
    const openDesktopRightPanel = ({ view = null, reset = false } = {}) => {
      if (!hasDesktopRightPanelOverlay() || !desktopRightPanel) return Promise.resolve();
      if (view) setDesktopRightPanelView(view);
      dpPanelOpen = true;
      dpApplyPanelWidth();
      dpSyncPinnedSummaryStrip();
      desktopRightPanel.hidden = false;
      desktopRightPanel.classList.add("open");
      document.body.classList.add("right-panel-open");
      if (dpGitContent && dpSplitPanel && !_dpSplitGitHeightPx) {
        requestAnimationFrame(() => {
          const panelH = dpSplitPanel.getBoundingClientRect().height;
          if (panelH > 0 && !_dpSplitGitHeightPx) {
            const initH = Math.max(80, Math.floor(panelH * 0.5));
            dpGitContent.style.height = `${initH}px`;
            _dpSplitGitHeightPx = initH;
          }
        });
      }
      const loadP = loadDesktopRightPanelView({ reset, animateRepo: false });
      notifyParentPanelState();
      return loadP;
    };
    const closeDesktopRightPanel = () => {
      if (!desktopRightPanel) return;
      dpStopPanelResize();
      dpPanelOpen = false;
      desktopRightPanel.classList.remove("open");
      desktopRightPanel.hidden = true;
      document.body.classList.remove("right-panel-open");
      dpDisconnectGitObserver();
      dpSyncPinnedSummaryStrip();
      notifyParentPanelState();
    };
    const toggleDesktopRightPanel = () => {
      if (dpPanelOpen) closeDesktopRightPanel();
      else openDesktopRightPanel();
    };
    const dpStopPanelResize = ({ persist = false } = {}) => {
      if (!_desktopRightPanelResizeState) return;
      _desktopRightPanelResizeState = null;
      document.body.classList.remove("desktop-right-panel-resizing");
      if (persist) dpPersistPanelWidthPx();
    };
    const dpHandlePanelResizeMove = (event) => {
      if (!_desktopRightPanelResizeState || !dpPanelOpen) return;
      const nextWidth = _desktopRightPanelResizeState.startWidth + (_desktopRightPanelResizeState.startX - event.clientX);
      dpPanelWidthPx = dpClampPanelWidthPx(nextWidth);
      dpApplyPanelWidth();
      notifyParentPanelState();
      if (needsHeaderViewportMetrics()) updateHeaderMenuViewportMetrics();
    };
    dpSplitDivider?.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      _dpSplitDragging = true;
      dpSplitDivider.classList.add("dragging");
      dpSplitDivider.setPointerCapture(e.pointerId);
      document.body.classList.add("dp-split-resizing");
    });
    dpSplitDivider?.addEventListener("pointermove", (e) => {
      if (!_dpSplitDragging || !dpGitContent || !dpSplitPanel) return;
      const rect = dpSplitPanel.getBoundingClientRect();
      let newH = e.clientY - rect.top - 3;
      newH = Math.max(80, Math.min(rect.height - 66, newH));
      dpGitContent.style.height = `${newH}px`;
      _dpSplitGitHeightPx = newH;
    });
    dpSplitDivider?.addEventListener("pointerup", () => {
      _dpSplitDragging = false;
      dpSplitDivider.classList.remove("dragging");
      document.body.classList.remove("dp-split-resizing");
    });
    dpSplitDivider?.addEventListener("pointercancel", () => {
      _dpSplitDragging = false;
      dpSplitDivider.classList.remove("dragging");
      document.body.classList.remove("dp-split-resizing");
    });
    desktopRightPanelResizer?.addEventListener("pointerdown", (event) => {
      if (!dpPanelOpen) return;
      event.preventDefault();
      event.stopPropagation();
      _desktopRightPanelResizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: dpCurrentPanelWidthPx(),
      };
      document.body.classList.add("desktop-right-panel-resizing");
      try {
        desktopRightPanelResizer.setPointerCapture(event.pointerId);
      } catch (_) {}
    });
    desktopRightPanelResizer?.addEventListener("pointermove", (event) => {
      if (!_desktopRightPanelResizeState || _desktopRightPanelResizeState.pointerId !== event.pointerId) return;
      dpHandlePanelResizeMove(event);
    });
    desktopRightPanelResizer?.addEventListener("pointerup", (event) => {
      if (!_desktopRightPanelResizeState || _desktopRightPanelResizeState.pointerId !== event.pointerId) return;
      dpStopPanelResize({ persist: true });
    });
    desktopRightPanelResizer?.addEventListener("pointercancel", () => {
      dpStopPanelResize({ persist: true });
    });
    const dpNormalizePath = (value) => String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const dpFolderIcon = wrapFileIcon('<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5.1a1.5 1.5 0 0 1 1.06.44l1.9 1.9a1.5 1.5 0 0 0 1.06.44H19.5A1.5 1.5 0 0 1 21 9.28V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');
    const dpChevronIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
    const dpBackIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>';
    const dpFetchRepoDir = async (rawPath) => {
      const path = dpNormalizePath(rawPath);
      const res = await fetchWithTimeout(`/files-dir?path=${encodeURIComponent(path)}`, {}, 12000);
      if (!res.ok) throw new Error(res.status === 404 ? "Directory not found" : "Failed to load directory");
      const payload = await res.json().catch(() => ({}));
      const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
      return rawEntries
        .filter((item) => item && typeof item.path === "string")
        .map((item) => {
          const entryPath = dpNormalizePath(item.path);
          const rawSize = Number(item.size);
          return {
            name: String(item.name || entryPath.split("/").pop() || entryPath),
            path: entryPath,
            kind: item.kind === "dir" ? "dir" : "file",
            size: item.kind === "dir" || !Number.isFinite(rawSize) || rawSize < 0 ? null : rawSize,
          };
        })
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        });
    };
    const dpBuildRepoEntryItem = (entry) => {
      const isDir = entry.kind === "dir";
      const btn = document.createElement("button");
      btn.type = "button";
      const displayName = isDir ? entry.name : displayAttachmentFilename(entry.path);
      btn.className = `repo-browser-item ${isDir ? "repo-browser-dir" : "repo-browser-file"}${displayName.startsWith(".") ? " repo-browser-item-dimmed" : ""}`;
      btn.title = entry.path;
      const iconEl = document.createElement("span");
      iconEl.className = "repo-browser-item-icon";
      iconEl.innerHTML = isDir ? dpFolderIcon : (FILE_ICONS[fileExtForPath(entry.path)] || FILE_SVG_ICONS.file);
      const nameEl = document.createElement("span");
      nameEl.className = "repo-browser-item-name";
      nameEl.textContent = displayName;
      btn.append(iconEl, nameEl);
      if (isDir) {
        const chevronEl = document.createElement("span");
        chevronEl.className = "repo-browser-item-chevron";
        chevronEl.innerHTML = dpChevronIcon;
        btn.appendChild(chevronEl);
        btn.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          void dpLoadRepoDir(entry.path);
        });
      } else {
        const sizeLabel = formatFileSize(entry.size);
        if (sizeLabel) {
          const sizeEl = document.createElement("span");
          sizeEl.className = "repo-browser-item-size";
          sizeEl.textContent = sizeLabel;
          btn.appendChild(sizeEl);
        }
        btn.addEventListener("click", async (e) => {
          e.preventDefault(); e.stopPropagation();
          await openFileSurface(entry.path, fileExtForPath(entry.path), btn, e);
        });
      }
      return btn;
    };
    const dpRepoEntriesStructureSignature = (entries) =>
      (entries || []).map((entry) => `${entry.kind}:${entry.path}`).join("\n");
    const dpRenderRepoPanel = (rawPath, entries, { loading = false, error = "", direction = "forward" } = {}) => {
      if (!dpRepoContent) return;
      const path = dpNormalizePath(rawPath);
      dpRepoBrowserPath = path;
      dpRepoContent.innerHTML = "";
      const stack = document.createElement("div");
      stack.className = `repo-browser-stack repo-browser-nav-${direction}`;
      const pathWrap = document.createElement("div");
      pathWrap.className = "repo-path-wrap";
      const pathRow = document.createElement("div");
      pathRow.className = `repo-path-back-btn${path ? " clickable" : ""}`;
      pathRow.setAttribute("role", "button");
      pathRow.setAttribute("aria-disabled", path ? "false" : "true");
      pathRow.tabIndex = path ? 0 : -1;
      pathRow.title = path ? "親ディレクトリへ" : "Root";
      pathRow.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!path) return;
        const parts = path.split("/").filter(Boolean);
        parts.pop();
        void dpLoadRepoDir(parts.join("/"));
      });
      pathRow.addEventListener("keydown", (e) => {
        if (e.target?.closest?.(".repo-path-nav-btn:not(.repo-path-back-icon-slot)")) return;
        if (!path || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault(); e.stopPropagation();
        const parts = path.split("/").filter(Boolean);
        parts.pop();
        void dpLoadRepoDir(parts.join("/"));
      });
      const backIcon = document.createElement("span");
      backIcon.className = "repo-path-nav-btn repo-path-back-icon-slot";
      backIcon.innerHTML = dpBackIcon;
      const pathText = document.createElement("span");
      pathText.className = "repo-path-label";
      pathText.textContent = path ? `/ ${path}` : "/";
      const rootBtn = document.createElement("button");
      rootBtn.type = "button";
      rootBtn.className = "repo-path-nav-btn repo-path-home-btn";
      rootBtn.innerHTML = wrapFileIcon('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>');
      rootBtn.title = "ルートへ";
      rootBtn.disabled = !path;
      rootBtn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        void dpLoadRepoDir("");
      });
      pathRow.append(backIcon, pathText, rootBtn);
      pathWrap.appendChild(pathRow);
      stack.appendChild(pathWrap);
      const scroll = document.createElement("div");
      scroll.className = "repo-browser-scroll";
      const list = document.createElement("div");
      list.className = "repo-browser-list";
      if (loading) {
        const node = document.createElement("div");
        node.className = "repo-browser-empty inline-loading-row";
        node.textContent = "";
        list.appendChild(node);
      } else if (error) {
        const node = document.createElement("div");
        node.className = "repo-browser-empty";
        node.textContent = error;
        list.appendChild(node);
      } else {
        const dirs = (entries || []).filter(e => e.kind === "dir");
        const files = (entries || []).filter(e => e.kind !== "dir");
        if (!dirs.length && !files.length) {
          const node = document.createElement("div");
          node.className = "repo-browser-empty";
          node.textContent = "Empty directory";
          list.appendChild(node);
        } else {
          dirs.forEach(e => list.appendChild(dpBuildRepoEntryItem(e)));
          files.forEach(e => list.appendChild(dpBuildRepoEntryItem(e)));
        }
      }
      scroll.appendChild(list);
      stack.appendChild(scroll);
      dpRepoContent.appendChild(stack);
    };
    const dpLoadRepoDir = async (rawPath, { animate = true } = {}) => {
      if (!dpPanelOpen) return;
      const path = dpNormalizePath(rawPath);
      const currentDepth = dpRepoBrowserPath.split("/").filter(Boolean).length;
      const newDepth = path.split("/").filter(Boolean).length;
      const direction = animate && newDepth > currentDepth ? "forward" : (animate ? "back" : "none");
      dpRepoBrowserNavDirection = direction;
      dpRenderRepoPanel(path, [], { loading: true, direction });
      try {
        const entries = await dpFetchRepoDir(path);
        if (!dpPanelOpen) return;
        dpRenderRepoPanel(path, entries, { direction });
      } catch (err) {
        if (!dpPanelOpen) return;
        dpRenderRepoPanel(path, [], { error: err?.message || "Failed to load directory", direction });
      }
    };
    const dpRefreshRepoDir = async (rawPath) => {
      if (!dpPanelOpen || !dpRepoContent?.querySelector(".repo-browser-stack")) return;
      const path = dpNormalizePath(rawPath);
      try {
        const entries = await dpFetchRepoDir(path);
        if (!dpPanelOpen || dpActivePanelView !== "repo" || dpNormalizePath(dpRepoBrowserPath) !== path) return;
        const currentEntries = Array.from(dpRepoContent.querySelectorAll(".repo-browser-item")).map((item) => ({
          kind: item.classList.contains("repo-browser-dir") ? "dir" : "file",
          path: dpNormalizePath(item.title || ""),
        }));
        if (dpRepoEntriesStructureSignature(currentEntries) !== dpRepoEntriesStructureSignature(entries)) {
          dpRenderRepoPanel(path, entries, { direction: "none" });
        }
      } catch (_) {}
    };
    window.addEventListener("message", (event) => {
      if (!event.data) return;
      if (event.data.type === "hub-theme-changed") {
        const chatTheme = event.data.chatTheme || event.data.theme;
        document.documentElement.dataset.theme = chatTheme === "light" ? "light" : "dark";
        const themeDesktop = event.data.themeDesktop;
        if (themeDesktop) {
          document.documentElement.dataset.themeDesktop = themeDesktop;
        } else {
          delete document.documentElement.dataset.themeDesktop;
        }
        return;
      }
      if (event.data.type === "desktop-panel-sync-request") {
        notifyParentPanelState();
        return;
      }
      if (event.data.type !== "desktop-panel") return;
      if (!hasDesktopRightPanelOverlay()) return;
      const mode = String(event.data.mode || "");
      if (mode === "close") {
        closeDesktopRightPanel();
      } else if (mode === "open") {
        toggleDesktopRightPanel();
      } else if (mode === "git") {
        openDesktopRightPanel({ view: "git", reset: true });
      } else if (mode === "repo") {
        openDesktopRightPanel({ view: "repo" });
      } else {
        toggleDesktopRightPanel();
      }
    });
    let workspaceSyncEventSource = null;
    let workspaceSyncLastSeq = 0;
    let workspaceSyncLastHubSettingsVersion = -1;
    const handleWorkspaceSyncUpdate = (payload = {}) => {
      const nextSeq = Math.max(0, parseInt(payload?.seq) || 0);
      if (nextSeq && nextSeq <= workspaceSyncLastSeq) return;
      if (nextSeq) workspaceSyncLastSeq = nextSeq;
      _dpGitOverviewFingerprint = "";
      if (dpPanelOpen && dpActivePanelView === "repo") {
        void dpRefreshRepoDir(dpRepoBrowserPath || "");
      }
      if (dpPanelOpen && dpActivePanelView === "git") {
        if (dpGitContent?.querySelector(".git-branch-stack")) {
          void dpRefreshGitOverview();
        } else {
          void dpLoadGitBranchPage({ reset: true });
        }
      } else if (dpPanelOpen || dpGitSummaryPinned) {
        void dpRefreshGitOverview();
      }
      const nextHubSettingsVersion = parseInt(payload?.hub_settings_version) || 0;
      if (nextHubSettingsVersion > workspaceSyncLastHubSettingsVersion) {
        workspaceSyncLastHubSettingsVersion = nextHubSettingsVersion;
        void syncChatSettingsDefaults();
      }
    };
    __CHAT_INCLUDE:../../../shared/chat/workspace-sync-events.js__
    dpOnSessionSummaryPinReload({ force: true });
    dpApplyPanelWidth();
    refresh({ forceScroll: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        void refresh();
      }
    });
