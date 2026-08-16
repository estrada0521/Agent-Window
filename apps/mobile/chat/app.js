__CHAT_INCLUDE:../../shared/chat/base.js__
    document.documentElement.dataset.mobile = "1";
    document.querySelectorAll("[data-desktop-only='1']").forEach((node) => {
      node.hidden = true;
      if (node.tagName === "OPTION") node.disabled = true;
    });
    document.querySelectorAll("[data-mobile-only='1']").forEach((node) => {
      node.hidden = false;
      if (node.tagName === "OPTION") node.disabled = false;
    });
    const _safariSafeAreaDummy = document.createElement("div");
    _safariSafeAreaDummy.style.cssText = "position:absolute;bottom:0;width:100%;height:env(safe-area-inset-bottom);pointer-events:none;opacity:0;z-index:-1;";
    document.body.appendChild(_safariSafeAreaDummy);
    const applyMobileThemeGradientVars = () => {
      const root = document.documentElement;
      const sheetChannels = getComputedStyle(root).getPropertyValue("--bg-rgb").trim() || (
        root.dataset.theme === "light" ? "249, 249, 247" : "13, 13, 12"
      );
      const topChannels = root.dataset.theme === "light" ? "255, 255, 255" : "0, 0, 0";
      root.style.setProperty("--mobile-top-gradient-rgb", topChannels);
      root.style.setProperty("--mobile-sheet-gradient-rgb", sheetChannels);
    };
    applyMobileThemeGradientVars();
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "data-theme")) {
        applyMobileThemeGradientVars();
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const fileViewHrefForPath = (path, { embed = false } = {}) => {
      const params = new URLSearchParams();
      params.set("path", String(path || ""));
      if (embed) {
        params.set("embed", "1");
        params.set("progressive", "1");
      }
      params.set("agent_font_mode", currentFilePreviewFontMode());
      if (CHAT_BASE_PATH) params.set("base_path", CHAT_BASE_PATH);
      params.set("base_theme", document.documentElement.dataset.theme === "light" ? "light" : "dark");
      params.set("preview_variant", "mobile");
      const textSize = currentFilePreviewTextSize();
      if (textSize) params.set("agent_text_size", textSize);
      return withChatBase(`/file-view?${params.toString()}`);
    };
    const buildInlineFileLinkMarkup = (path, label = "") => {
      const normalizedPath = String(path || "").trim();
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
    const _pageParams = new URLSearchParams(window.location.search || "");
    const followMode = _pageParams.get("follow") === "1";
    const launchShellMode = _pageParams.get("launch_shell") === "1";
    const composerAutoOpenRequested = _pageParams.get("compose") === "1";
    const reconnectingStatusText = "reconnecting...";
    let messageRefreshFailures = 0;
    let reconnectStatusVisible = false;
    let refreshInFlight = false;
    let pendingRefreshOptions = null;
    let sessionStateInFlight = false;
    let pendingSessionStateRefresh = false;
    let pendingSessionStateProjections = [];
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
__CHAT_INCLUDE:../../shared/chat/launch-shell-gate.js__
    if (launchShellMode) {
      armLaunchShellGate(10000);
    }
    const syncMainAfterHeight = () => {
      const mainEl = document.querySelector("main");
      if (!mainEl) return;
      const lockHeight = parseInt(document.documentElement.style.getPropertyValue("--hub-iframe-lock-height"), 10) || 0;
      const baseHeight = lockHeight > 0
        ? lockHeight
        : Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
      if (baseHeight <= 0) return;
      const fixedSpacerHeight = Math.round(baseHeight * 0.5);
      mainEl.style.setProperty("--main-spacer-height", fixedSpacerHeight + "px");
      mainEl.style.removeProperty("--main-after-height");
    };
    let _pollScrollLockTop = null;
    let _pollScrollAnchor = null;
    syncMainAfterHeight();
    window.addEventListener("resize", syncMainAfterHeight, { passive: true });
    if (window.visualViewport) {
      const onVVResize = () => {
        syncMainAfterHeight();
        updateScrollBtnPos();
        if (_stickyToBottom && timeline) {
          _pollScrollLockTop = null;
          _pollScrollAnchor = null;
          timeline.scrollTop = timeline.scrollHeight;
        }
      };
      visualViewport.addEventListener("resize", onVVResize);
      visualViewport.addEventListener("scroll", onVVResize);
    }
    let _hubIframeLayoutMaxH = 0;
    let _hubIframeLayoutFromParent = 0;
    let _hubChromeGapClientMin = Infinity;
    let _hubChildOriW = 0;
    let _hubChildOriH = 0;
    const applyHubIframeLockHeight = () => {
      if (!window.frameElement) {
        syncMainAfterHeight();
        return;
      }
      const local = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
      _hubIframeLayoutMaxH = Math.max(_hubIframeLayoutMaxH, local);
      const h = Math.max(_hubIframeLayoutMaxH, _hubIframeLayoutFromParent);
      if (h > 0) {
        document.documentElement.style.setProperty("--hub-iframe-lock-height", h + "px");
      }
      syncMainAfterHeight();
    };
    const bumpHubIframeLayoutLock = () => {
      if (!window.frameElement) return;
      applyHubIframeLockHeight();
    };
    const requestHubParentLayout = () => {
      if (!window.frameElement) return;
      try {
        window.parent.postMessage({ type: "chat-request-hub-layout" }, "*");
      } catch (_) { }
    };
    const requestHubCloseChat = () => {
      if (!window.frameElement) return;
      try {
        window.parent.postMessage("hub_close_chat", "*");
      } catch (_) { }
    };
    const notifyHubChatRenderReady = () => {
      if (!window.frameElement) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            window.parent.postMessage({ type: "chat-render-ready" }, "*");
          } catch (_) { }
        });
      });
    };
    if (window.frameElement) {
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
      __CHAT_INCLUDE:../../shared/chat/hub-safari-chrome.js__
      bumpHubIframeLayoutLock();
      hubPingParentForSafariChrome();
      setTimeout(hubPingParentForSafariChrome, 120);
      setTimeout(hubPingParentForSafariChrome, 400);
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
    window.addEventListener("message", (e) => {
      if (!e.data || e.data.type !== "hub-theme-changed") return;
      document.documentElement.dataset.theme = e.data.theme === "light" ? "light" : "dark";
    });
    if (window.parent !== window) {
      const reportObservedSystemTheme = () => {
        try {
          window.parent.postMessage({
            type: "hub-mobile-system-theme-observed",
            theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
          }, "*");
        } catch (_) {}
      };
      try {
        const query = window.matchMedia("(prefers-color-scheme: dark)");
        if (query.addEventListener) query.addEventListener("change", reportObservedSystemTheme);
        else if (query.addListener) query.addListener(reportObservedSystemTheme);
      } catch (_) {}
      window.addEventListener("pageshow", reportObservedSystemTheme);
      window.addEventListener("focus", reportObservedSystemTheme);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) reportObservedSystemTheme();
      });
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
            } catch (_) { }
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
        } catch (_) { }
      }
    };
__CHAT_INCLUDE:modals/file-modal.js__
__CHAT_INCLUDE:../../shared/chat/composer-overlay.js__
    const updateScrollBtnPos = () => {
      const shell = document.querySelector(".shell");
      shell.style.setProperty("--floating-btn-bottom", "160px");
      shell.style.setProperty("--composer-height", "0px");
    };
    const mathRenderOptions = {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false }
      ],
      ignoredClasses: ["no-math"],
      throwOnError: false
    };
__CHAT_INCLUDE:../../shared/chat/transcript/rich-rendering.js__
    let selectedTargets = [];
    let sendLocked = false;
    let sessionActive = true;
    let composerAutoOpenConsumed = false;
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
        const bodyWidth = Math.round(body.getBoundingClientRect().width || bodyRow.clientWidth || 0);
        if (bodyWidth < 40) {
          row.classList.remove("is-collapsible");
          bodyRow.classList.remove("is-collapsed");
          toggle.classList.remove("is-visible");
          toggle.hidden = true;
          const retries = Math.max(0, parseInt(row.dataset.collapseRetry || "0", 10) || 0);
          if (retries < 3) {
            row.dataset.collapseRetry = String(retries + 1);
            requestAnimationFrame(() => requestAnimationFrame(() => syncMessageCollapse(row)));
          } else {
            row.dataset.collapseRetry = "0";
          }
          return;
        }
        row.dataset.collapseRetry = "0";
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
    const renderTargetPicker = (targets) => {
      const root = document.getElementById("targetPicker");
      const selectedSet = new Set(selectedTargets);
      const targetsSig = JSON.stringify(targets);
      const selectionSig = JSON.stringify([...selectedSet].sort());
      const renderSig = `${targetsSig}|${selectionSig}`;
      if (root.dataset.renderSig === renderSig) return;

      if (root.dataset.targetsSig !== targetsSig) {
        root.dataset.targetsSig = targetsSig;
        root.innerHTML = targets.map((target) => {
          return `<button type="button" class="target-chip" data-target="${target}" data-base-agent="${agentBaseName(target)}" title="${escapeHtml(target)}"><span class="agent-icon-slot agent-icon-slot--chip"><span class="target-icon" aria-hidden="true" style="--agent-icon-mask:url('${escapeHtml(agentIconSrc(target))}')"></span>${agentIconInstanceSubHtml(target)}</span></button>`;
        }).join("");
        root.querySelectorAll(".target-chip").forEach((node) => {
          node.addEventListener("mousedown", (e) => e.preventDefault());
          node.addEventListener("click", () => {
            const target = node.dataset.target;
            if (selectedTargets.includes(target)) {
              selectedTargets = selectedTargets.filter((item) => item !== target);
            } else {
              selectedTargets = [...selectedTargets, target];
            }
            saveTargetSelection(currentSessionName, selectedTargets);
            renderTargetPicker(availableTargets);
          });
        });
      }
      root.querySelectorAll(".target-chip").forEach((node) => {
        node.classList.toggle("active", selectedSet.has(node.dataset.target));
      });
      root.dataset.renderSig = renderSig;
    };
    const setQuickActionsDisabled = (disabled) => {
      document.querySelectorAll(".quick-action").forEach((node) => {
        node.disabled = disabled;
      });
    };
    const STICKY_THRESHOLD = 32;
    const PUBLIC_OLDER_AUTOLOAD_THRESHOLD = 120;
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
      } catch (_) { }
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
      if (timeline.scrollTop > PUBLIC_OLDER_AUTOLOAD_THRESHOLD) return;
      void loadOlderMessages();
    }, { passive: true });
    const updateScrollBtn = () => {
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
      const nodes = targetNode ? [targetNode] : document.querySelectorAll("#hubPageMenuBtn, #rightMenuBtn");
      nodes.forEach((node) => {
        if (node.classList.contains("animating")) return;
        node.classList.add("animating");
        setTimeout(() => {
          node.classList.remove("animating");
        }, 500);
      });
    };
    document.addEventListener("pointerdown", (e) => {
      const toggle = e.target.closest(".hub-page-menu-btn, .composer-plus-toggle, .quick-action");
      if (toggle) {
        if (toggle.classList.contains("animating")) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        flashHeaderToggle(toggle);
      }
    });
    const flashComposerAction = (action) => {
      document.querySelectorAll(`.composer-plus-panel [data-forward-action="${action}"]`).forEach((node) => {
        node.classList.remove("toggle-flash");
        void node.offsetWidth;
        node.classList.add("toggle-flash");
        setTimeout(() => node.classList.remove("toggle-flash"), 120);
      });
    };
__CHAT_INCLUDE:../../shared/chat/target-selection.js__
    const normalizedSessionTargets = (rawTargets) => {
      return Array.isArray(rawTargets)
        ? rawTargets.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
        : [];
    };
    timeline.addEventListener("scroll", updateScrollBtn, { passive: true });
    timeline.addEventListener("scroll", requestCenteredMessageRowUpdate, { passive: true });
    window.addEventListener("resize", requestCenteredMessageRowUpdate);

__CHAT_INCLUDE:../../shared/chat/runtime/messages.js__
__CHAT_INCLUDE:../../shared/chat/transcript/render.js__
__CHAT_INCLUDE:../../shared/chat/transcript/actions.js__
__CHAT_INCLUDE:runtime/hub-navigation.js__
__CHAT_INCLUDE:panes/header-menu.js__
__CHAT_INCLUDE:panes/right-pane.js__
__CHAT_INCLUDE:composer/runtime.js__
__CHAT_INCLUDE:../../shared/chat/attachments/file-runtime.js__
__CHAT_INCLUDE:../../shared/chat/composer/commands.js__
__CHAT_INCLUDE:../../shared/chat/thinking.js__
__CHAT_INCLUDE:runtime/agent-status.js__
__CHAT_INCLUDE:../../shared/chat/touch-interaction.js__
__CHAT_INCLUDE:runtime/settings-sync.js__
__CHAT_INCLUDE:panes/pane-viewer.js__
    let workspaceSyncEventSource = null;
    let workspaceSyncLastSeq = 0;
    const handleWorkspaceSyncUpdate = (payload = {}) => {
      const nextSeq = Math.max(0, parseInt(payload?.seq) || 0);
      if (nextSeq && nextSeq <= workspaceSyncLastSeq) return;
      if (nextSeq) workspaceSyncLastSeq = nextSeq;
      const repoPanelOpen = !!(repoPanel && repoPanel.classList.contains("open") && !repoPanel.hidden);
      if (repoPanelOpen && typeof repoPanel._syncCategoryUi === "function") {
        repoPanel._syncCategoryUi();
      }
      const gitPanelOpen = !!(gitBranchPanel && gitBranchPanel.classList.contains("open") && !gitBranchPanel.hidden);
      if (gitPanelOpen) {
        void updateGitBranchPanel().catch(() => {});
      }
    };
    __CHAT_INCLUDE:../../shared/chat/workspace-sync-events.js__
    refresh({ forceScroll: true });
    if (followMode) {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
          void refresh();
        }
      });
    }
