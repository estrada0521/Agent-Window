__INCLUDE:../base.js__
    const DESKTOP_FILE_PANE_MIN_VIEWPORT_PX = 961;
    let _scrollbarLayoutSyncFrame = 0;
    let _fitTargetRow = null;
    let _fitCollapsed = false;
    const syncRoomScrollbarLayoutWidth = () => {
      const mainEl = document.querySelector("main");
      if (!mainEl || document.documentElement.dataset.mobile === "1") return;
      const width = Math.max(0, mainEl.offsetWidth - mainEl.clientWidth);
      const next = `${width}px`;
      if (mainEl.style.getPropertyValue("--room-scrollbar-layout-width") !== next) {
        mainEl.style.setProperty("--room-scrollbar-layout-width", next);
      }
    };
    const scheduleRoomScrollbarLayoutWidthSync = () => {
      if (_scrollbarLayoutSyncFrame) return;
      _scrollbarLayoutSyncFrame = requestAnimationFrame(() => {
        _scrollbarLayoutSyncFrame = 0;
        syncRoomScrollbarLayoutWidth();
      });
    };
    const mainScrollbarEl = document.querySelector("main");
    if (mainScrollbarEl && typeof ResizeObserver === "function") {
      new ResizeObserver(scheduleRoomScrollbarLayoutWidthSync).observe(mainScrollbarEl);
    }
    const syncMainAfterHeight = () => {
      const mainEl = document.querySelector("main");
      if (!mainEl) return;
      if (document.documentElement.dataset.autoWindowHeight === "1") {
        mainEl.style.setProperty("--main-spacer-height", "0px");
      } else {
        mainEl.style.removeProperty("--main-spacer-height");
      }
      mainEl.style.removeProperty("--main-after-height");
    };
    const syncAppShellHeight = () => {
      document.documentElement.style.removeProperty("--app-shell-height");
      document.documentElement.style.removeProperty("--mobile-overlay-lock-height");
      syncMainAfterHeight();
    };
    syncAppShellHeight();
    scheduleRoomScrollbarLayoutWidthSync();
    window.addEventListener("pageshow", () => syncAppShellHeight());
    window.addEventListener("resize", () => {
      syncAppShellHeight();
      scheduleRoomScrollbarLayoutWidthSync();
      if (document.documentElement.dataset.autoWindowHeight === "1") {
        if (_fitTargetRow?.isConnected) return;
        _fitTargetRow = null;
        _stickyToBottom = true;
        requestAnimationFrame(() => scrollConversationToBottom("auto"));
      }
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
__INCLUDE:../conversation-state.js__
    const timeline = document.getElementById("messages");
    let _pollScrollLockTop = null;
    let _pollScrollAnchor = null;
    let _hubIframeLayoutMaxH = 0;
    let _hubIframeLayoutFromParent = 0;
    let _hubChromeGapClientMin = Infinity;
    let _hubChildOriW = 0;
    let _hubChildOriH = 0;
    const isHubIframeRoom = () =>
      document.documentElement.dataset.hubIframeRoom === "1" ||
      document.documentElement.dataset.hubShell === "1" ||
      window.parent !== window;
    const applyHubIframeLockHeight = () => {
      if (!isHubIframeRoom()) return;
      const local = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
      _hubIframeLayoutMaxH = Math.max(_hubIframeLayoutMaxH, local);
      const h = Math.max(_hubIframeLayoutMaxH, _hubIframeLayoutFromParent);
      if (h > 0) {
        document.documentElement.style.setProperty("--hub-iframe-lock-height", h + "px");
      }
    };
    const bumpHubIframeLayoutLock = () => {
      if (!isHubIframeRoom()) return;
      applyHubIframeLockHeight();
    };
    const requestHubParentLayout = () => {
      if (!isHubIframeRoom()) return;
      window.parent.postMessage({ type: "room-request-hub-layout" }, "*");
    };
    const notifyHubRoomRenderReady = () => {
      if (!isHubIframeRoom()) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.parent.postMessage({ type: "room-render-ready" }, "*");
        });
      });
    };
    const notifyHubRoomRenderError = () => {
      if (!isHubIframeRoom()) return;
      window.parent.postMessage({ type: "room-render-error" }, "*");
    };
    if (isHubIframeRoom()) {
      document.documentElement.dataset.hubIframeRoom = "1";
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
      __INCLUDE:../hub-safari-chrome.js__
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

    const reportFitHeight = ({ fromComposer = false, restore = false } = {}) => {
      if (!isHubIframeRoom() || document.documentElement.dataset.autoWindowHeight !== "1") return;
      const scroller = timeline || document.getElementById("messages");
      const rows = scroller
        ? scroller.querySelectorAll(":scope > article.message-row, :scope > .sysmsg-row")
        : null;
      if (!rows || !rows.length) return;
      const fitTarget = _fitTargetRow?.isConnected && _fitTargetRow.parentElement === scroller
        ? _fitTargetRow
        : null;
      if (_fitTargetRow && !fitTarget) _fitTargetRow = null;
      const lastRow = rows[rows.length - 1];
      const edgeGap = messageStepTopGap();
      let contentHeight;
      if (fitTarget) {
        const r = fitTarget.getBoundingClientRect();
        contentHeight = Math.ceil(r.bottom - r.top + edgeGap);
      } else {
        const lastTopWithin = lastRow.getBoundingClientRect().top
          - scroller.getBoundingClientRect().top + scroller.scrollTop;
        contentHeight = Math.ceil(scroller.scrollHeight - lastTopWithin);
      }
      if (isComposerOverlayOpen()) {
        const box = document.getElementById("composer");
        if (box) {
          const inputStyle = getComputedStyle(messageInput);
          const fieldOverflow = parseFloat(inputStyle.maxHeight) - parseFloat(inputStyle.minHeight);
          const fitSlack = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-size")) * 20 / 13;
          contentHeight = Math.ceil(box.offsetHeight + fieldOverflow + fitSlack);
        }
      }
      contentHeight += edgeGap;
      if (contentHeight > 0) {
        if (!fromComposer && fitTarget) {
          _stickyToBottom = false;
          _programmaticScroll = true;
          positionConversationRowAtStepTop(fitTarget, "auto");
          requestAnimationFrame(() => { _programmaticScroll = false; });
        } else if (!fromComposer) {
          _stickyToBottom = true;
          scrollConversationToBottom("auto");
        }
        window.parent.postMessage({ type: "fit-window-height", contentHeight, restore }, "*");
      }
    };
    const fitMessageRows = () => [...timeline.querySelectorAll(":scope > article.message-row")];
    const fitStepToLatest = () => {
      _fitTargetRow = null;
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
      _stickyToBottom = true;
      reportFitHeight();
    };
    const fitStepToFirst = () => {
      const rows = fitMessageRows();
      if (!rows.length) return;
      _fitTargetRow = rows[0];
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
      _stickyToBottom = false;
      reportFitHeight();
    };
    const fitStepToMessage = (down) => {
      const rows = fitMessageRows();
      if (!rows.length) return;
      const stepTop = timeline.getBoundingClientRect().top + messageStepTopGap();
      let next = null;
      if (down) {
        for (const row of rows) {
          if (row.getBoundingClientRect().top - stepTop > 2) { next = row; break; }
        }
        if (!next || next === rows[rows.length - 1]) { fitStepToLatest(); return; }
      } else {
        for (const row of rows) {
          if (row.getBoundingClientRect().top - stepTop < -2) next = row; else break;
        }
        if (!next) return;
      }
      _fitTargetRow = next;
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
      _stickyToBottom = false;
      reportFitHeight();
    };
    document.addEventListener("room-transcript-settled", () => {
      if (_fitCollapsed) { _fitTargetRow = null; _stickyToBottom = true; }
      reportFitHeight({ restore: true });
    });
    let _thinkingRefitFrame = 0;
    document.addEventListener("room-thinking-updated", () => {
      if (document.documentElement.dataset.autoWindowHeight !== "1" || _thinkingRefitFrame) return;
      _thinkingRefitFrame = requestAnimationFrame(() => {
        _thinkingRefitFrame = 0;
        reportFitHeight();
      });
    });
    let _recollapseOnComposerClose = false;
    document.addEventListener("composer-overlay-open", () => {
      if (document.documentElement.dataset.autoWindowHeight !== "1") return;
      if (_fitCollapsed) { _fitTargetRow = null; _stickyToBottom = true; _recollapseOnComposerClose = true; }
      requestAnimationFrame(() => reportFitHeight({ fromComposer: true, restore: true }));
    });
    document.addEventListener("composer-overlay-close-start", () => {
      if (document.documentElement.dataset.sendInFlight === "1") {
        _recollapseOnComposerClose = false;
        _fitTargetRow = null;
        _stickyToBottom = true;
        return;
      }
      if (_recollapseOnComposerClose) {
        _recollapseOnComposerClose = false;
        window.parent?.postMessage({ type: "fit-collapse-shortcut" }, "*");
        return;
      }
      requestAnimationFrame(() => reportFitHeight());
    });
    document.addEventListener("room-send-failed", () => {
      if (document.documentElement.dataset.autoWindowHeight !== "1") return;
      requestAnimationFrame(() => reportFitHeight());
    });
__INCLUDE:../scroll-focus.js__
__INCLUDE:file-open.js__
__INCLUDE:../composer-overlay.js__
__INCLUDE:../rich-rendering-setup.js__
__INCLUDE:../transcript-rich-rendering.js__
__INCLUDE:../message-collapse.js__
__INCLUDE:../target-picker.js__
__INCLUDE:../target-selection.js__
__INCLUDE:../composer-draft.js__
__INCLUDE:../scroll-lock.js__
    const updateStickyState = () => {
      if (_programmaticScroll || _pinStickyThroughWidthChange) return;
      _stickyToBottom = isNearBottom();
      refreshViewportCenterAnchor();
    };
__INCLUDE:../scroll-btn.js__
    let _timelineLayoutWidth = timeline.clientWidth;
    let _widthChangeSequence = 0;
    new ResizeObserver(() => {
      const width = timeline.clientWidth;
      const prevWidth = _timelineLayoutWidth;
      _timelineLayoutWidth = width;
      if (width === prevWidth) return;
      const sequence = ++_widthChangeSequence;
      const wasAtBottom = _atBottomAtAnchorWidth;
      const centerAnchor = _viewportCenterAnchor || captureViewportCenterAnchor();
      _pinStickyThroughWidthChange = true;
      const apply = (remaining) => {
        if (sequence !== _widthChangeSequence) return;
        if (wasAtBottom) timeline.scrollTop = timeline.scrollHeight;
        else restoreViewportCenterAnchor(centerAnchor);
        if (remaining <= 0) {
          _pinStickyThroughWidthChange = false;
          _anchorLayoutWidth = timeline.clientWidth;
          refreshViewportCenterAnchor();
          _stickyToBottom = isNearBottom();
          updateScrollBtn();
          return;
        }
        requestAnimationFrame(() => apply(remaining - 1));
      };
      apply(2);
    }).observe(timeline);

    {
      const header = document.querySelector(".page-header");
      if (header) header.classList.remove("header-hidden");
      timeline.addEventListener("scroll", () => {
        if (header?.classList.contains("header-hidden")) {
          header.classList.remove("header-hidden");
        }
      }, { passive: true });
    }

__INCLUDE:../messages.js__
__INCLUDE:../transcript-render.js__
    if (typeof marked === "undefined") {
      const _rerenderWhenMarkedReady = () => {
        if (typeof marked !== "undefined") rerenderCurrentMessages({ suppressEntryAnimation: true });
      };
      window.addEventListener("DOMContentLoaded", _rerenderWhenMarkedReady, { once: true });
      window.addEventListener("load", _rerenderWhenMarkedReady, { once: true });
    }
__INCLUDE:../transcript-actions.js__
__INCLUDE:room-menu.js__
__INCLUDE:header-actions.js__
__INCLUDE:../composer.js__
__INCLUDE:../file-links.js__
__INCLUDE:../composer-commands.js__
__INCLUDE:../thinking.js__
__INCLUDE:../agent-status.js__
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent || event.data?.type !== "refresh-room-state") return;
      void refreshRoomState();
    });
__INCLUDE:../pointer-capability.js__
    const desktopRightPanel = document.getElementById("desktopRightPanel");
    const desktopRightPanelResizer = document.getElementById("desktopRightPanelResizer");
    const dpSplitPanel = document.getElementById("dpSplitPanel");
    const dpSplitDivider = document.getElementById("dpSplitDivider");
    const dpRepoContent = document.getElementById("dpRepoContent");
    const dpGitContent = document.getElementById("dpGitContent");
    const DP_TEXT_SIZE_DEFAULT = __TEXT_SIZE_DEFAULT__;
    const DP_PANEL_DEFAULT_WIDTH_AT_DEFAULT_TEXT_SIZE = 220;
    const DP_PANEL_MIN_WIDTH_AT_DEFAULT_TEXT_SIZE = 220;
    const DP_PANEL_MAX_WIDTH_AT_DEFAULT_TEXT_SIZE = 560;
    const DP_ROOM_MIN_WIDTH_AT_DEFAULT_TEXT_SIZE = 360;
    const DP_PANEL_WIDTH_KEY = "agent_window_desktop_right_panel_width_at_default_text_size";
    const DP_PANEL_GAP = 0;
    let dpPanelOpen = false;
    let dpActivePanelView = "repo";
    let dpRepoBrowserPath = "";
    let dpRepoLoadSeq = 0;
    let cancelDpRepoLoading = () => {};
    // A row-list multi-select: a Set of selected paths plus a shift-range anchor,
    // read fresh from the DOM each time (order, membership) instead of a
    // separately-maintained array -- one implementation shared by the repo file
    // tree and the git panel's file rows, which only differ in container/selector.
    const createRowSelection = ({ container, rowSelector, selectedClass = "is-selected" }) => {
      let selected = new Set();
      let anchor = "";
      const order = () => Array.from(container?.querySelectorAll(rowSelector) || [])
        .map((el) => el.dataset.path || "")
        .filter(Boolean);
      const applyClasses = () => {
        container?.querySelectorAll(rowSelector).forEach((el) => {
          el.classList.toggle(selectedClass, selected.has(el.dataset.path || ""));
        });
      };
      const set = (paths) => { selected = new Set(paths); applyClasses(); };
      const clear = () => { set([]); anchor = ""; };
      const toggle = (path) => { const next = new Set(selected); next.has(path) ? next.delete(path) : next.add(path); set(next); anchor = path; };
      const selectRangeTo = (path) => {
        const list = order();
        const a = anchor || path;
        const ai = list.indexOf(a);
        const ti = list.indexOf(path);
        set(ai === -1 || ti === -1 ? [path] : list.slice(Math.min(ai, ti), Math.max(ai, ti) + 1));
        anchor = a;
      };
      const orderedSelected = () => order().filter((p) => selected.has(p));
      const prune = () => { const present = new Set(order()); if (selected.size) set([...selected].filter((p) => present.has(p))); };
      container?.addEventListener("mouseleave", clear);
      return { get selected() { return selected; }, set, clear, toggle, selectRangeTo, orderedSelected, prune, applyClasses };
    };
    // Consumes a click's modifier keys against a selection: shift/meta only
    // mutate the selection (returns null); otherwise resolves what to act on --
    // the rest of the current selection if the click landed on it, else just
    // this row -- and whether it was an option-click (Quick Look) or plain.
    const dpResolveRowClick = (sel, path, event) => {
      if (event.shiftKey) { sel.selectRangeTo(path); return null; }
      if (event.metaKey) { sel.toggle(path); return null; }
      const isMulti = sel.selected.size > 1 && sel.selected.has(path);
      const targets = isMulti ? sel.orderedSelected() : [path];
      if (!isMulti) sel.set([path]);
      return { targets, quickLook: event.altKey };
    };
    const dpResolveContextMenuTargets = (sel, path) => {
      if (!(sel.selected.size > 1 && sel.selected.has(path))) sel.set([path]);
      return sel.orderedSelected();
    };
    const dpRepoSel = createRowSelection({ container: dpRepoContent, rowSelector: ".repo-browser-item" });
    const dpRepoFilePathSet = () => new Set(Array.from(dpRepoContent?.querySelectorAll(".repo-browser-file") || []).map((el) => el.dataset.path || ""));
    const dpRepoOrderedSelectedFiles = () => dpRepoSel.orderedSelected().filter((p) => dpRepoFilePathSet().has(p));
    const dpRepoOrderedSelectedEntries = () => dpRepoSel.orderedSelected();
    const dpGitSel = createRowSelection({ container: dpGitContent, rowSelector: ".git-commit-file-row" });
    const dpGitOrderedSelectedFiles = () => dpGitSel.orderedSelected();
    const dpActivePanelTargets = (repoOrdered, repoHoverSel, gitHoverSel) => {
      if (!dpPanelOpen) return [];
      let repoTargets = repoOrdered();
      if (!repoTargets.length) {
        const hovered = dpRepoContent?.querySelector(repoHoverSel);
        if (hovered?.dataset.path) repoTargets = [hovered.dataset.path];
      }
      if (repoTargets.length) return repoTargets;
      let gitTargets = dpGitOrderedSelectedFiles();
      if (!gitTargets.length) {
        const hovered = dpGitContent?.querySelector(gitHoverSel);
        if (hovered?.dataset.path) gitTargets = [hovered.dataset.path];
      }
      return gitTargets;
    };
    let dpPanelWidthAtDefaultTextSize = DP_PANEL_DEFAULT_WIDTH_AT_DEFAULT_TEXT_SIZE;
    let _desktopRightPanelResizeState = null;
    let _dpSplitDragging = false;
    let _dpSplitGitHeightPx = null;
    const dpRoundPanelWidth = (value) => Math.round(value * 100) / 100;
    const dpCurrentTextSizePx = () => {
      const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-size"));
      return Number.isFinite(raw) && raw > 0 ? raw : DP_TEXT_SIZE_DEFAULT;
    };
    const dpScalePanelWidth = (value) => (
      dpRoundPanelWidth(Number(value) * dpCurrentTextSizePx() / DP_TEXT_SIZE_DEFAULT)
    );
    const dpUnscalePanelWidth = (value) => (
      dpRoundPanelWidth(Number(value) * DP_TEXT_SIZE_DEFAULT / dpCurrentTextSizePx())
    );
    const dpClampPanelWidthAtDefaultTextSize = (value, { constrainToViewport = true } = {}) => {
      const numeric = Number(value);
      const width = Number.isFinite(numeric) ? numeric : DP_PANEL_DEFAULT_WIDTH_AT_DEFAULT_TEXT_SIZE;
      let maxWidth = DP_PANEL_MAX_WIDTH_AT_DEFAULT_TEXT_SIZE;
      if (constrainToViewport) {
        const viewportWidthAtDefaultTextSize = Math.max(0, window.innerWidth || 0) * DP_TEXT_SIZE_DEFAULT / dpCurrentTextSizePx();
        maxWidth = Math.max(
          DP_PANEL_MIN_WIDTH_AT_DEFAULT_TEXT_SIZE,
          Math.min(DP_PANEL_MAX_WIDTH_AT_DEFAULT_TEXT_SIZE, viewportWidthAtDefaultTextSize - DP_ROOM_MIN_WIDTH_AT_DEFAULT_TEXT_SIZE),
        );
      }
      return dpRoundPanelWidth(Math.max(DP_PANEL_MIN_WIDTH_AT_DEFAULT_TEXT_SIZE, Math.min(maxWidth, width)));
    };
    const storedPanelWidth = Number.parseFloat(localStorage.getItem(DP_PANEL_WIDTH_KEY) || "");
    if (Number.isFinite(storedPanelWidth) && storedPanelWidth > 0) {
      dpPanelWidthAtDefaultTextSize = storedPanelWidth;
    }
    const dpOutwardPanelWidthPx = () => {
      if (dpPanelOpen) return dpCurrentPanelWidthPx();
      return dpScalePanelWidth(dpClampPanelWidthAtDefaultTextSize(
        dpPanelWidthAtDefaultTextSize,
        { constrainToViewport: false },
      ));
    };
    const dpPersistPanelWidthAtDefaultTextSize = () => {
      if (dpPanelWidthAtDefaultTextSize > 0) {
        localStorage.setItem(DP_PANEL_WIDTH_KEY, String(dpPanelWidthAtDefaultTextSize));
      }
    };
    const dpCurrentPanelWidthPx = () => dpScalePanelWidth(
      dpClampPanelWidthAtDefaultTextSize(dpPanelWidthAtDefaultTextSize),
    );
    const dpApplyPanelWidth = () => {
      const panelWidth = dpPanelOpen ? dpCurrentPanelWidthPx() : 0;
      document.documentElement.style.setProperty("--desktop-right-panel-width", `${panelWidth}px`);
      document.documentElement.style.setProperty("--desktop-right-panel-reserved-width", `${panelWidth > 0 ? panelWidth + DP_PANEL_GAP : 0}px`);
    };
__INCLUDE:../../list-flip.js__
__INCLUDE:../git-panel-html.js__
__INCLUDE:../git-panel-data.js__
__INCLUDE:../git-panel-controller.js__
__INCLUDE:git-panel/state.js__
__INCLUDE:git-panel/render.js__
__INCLUDE:git-panel/data.js__
__INCLUDE:git-panel/events.js__

    const syncPanelState = () => {
      document.getElementById("roomPanelToggle").setAttribute("aria-pressed", dpPanelOpen ? "true" : "false");
      if (window.parent !== window) {
        window.parent.postMessage({
          type: "desktop-panel-state",
          mode: dpPanelOpen ? "open" : "",
          view: dpActivePanelView,
          width: dpOutwardPanelWidthPx(),
        }, "*");
      }
    };
    window.addEventListener("resize", () => {
      dpApplyPanelWidth();
      syncPanelState();
    });
    const setDesktopRightPanelView = (view) => {
      dpActivePanelView = view === "git" ? "git" : "repo";
      return dpActivePanelView;
    };
    const loadDesktopRightPanelView = ({ reset = false, animateRepo = true } = {}) => {
      if (!dpPanelOpen) return Promise.resolve();
      const hasGitShell = gitPanel.hasShell();
      if (reset && hasGitShell) dpCloseGitDetail();
      const gitP = hasGitShell ? dpRefreshGitOverview() : dpLoadGitPage({ reset: true });
      dpLoadRepoDir(dpRepoBrowserPath || "", { animate: animateRepo });
      return Promise.resolve(gitP);
    };
    const openDesktopRightPanel = ({ view = null, reset = false } = {}) => {
      if (!desktopRightPanel) return Promise.resolve();
      if (view) setDesktopRightPanelView(view);
      dpPanelOpen = true;
      dpApplyPanelWidth();
      dpSyncPinnedSummaryStrip();
      const existingStack = dpRepoContent?.querySelector(".repo-browser-stack");
      if (existingStack) {
        existingStack.classList.remove("repo-browser-nav-forward", "repo-browser-nav-back");
        existingStack.classList.add("repo-browser-nav-none");
      }
      desktopRightPanel.hidden = false;
      desktopRightPanel.classList.add("open");
      document.body.classList.add("right-panel-open");
      if (dpGitContent && dpSplitPanel && !_dpSplitGitHeightPx) {
        requestAnimationFrame(() => {
          const panelH = dpSplitPanel.getBoundingClientRect().height;
          if (panelH > 0 && !_dpSplitGitHeightPx) {
            const initH = Math.floor(panelH * 0.5);
            dpGitContent.style.height = `${initH}px`;
            _dpSplitGitHeightPx = initH;
          }
        });
      }
      const loadP = loadDesktopRightPanelView({ reset, animateRepo: false });
      syncPanelState();
      return loadP;
    };
    const closeDesktopRightPanel = () => {
      if (!desktopRightPanel) return;
      const wasAtBottom = _atBottomAtAnchorWidth || timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= 2;
      dpStopPanelResize();
      dpPanelOpen = false;
      if (gitPanel.hasShell()) dpCloseGitDetail();
      desktopRightPanel.classList.remove("open");
      desktopRightPanel.hidden = true;
      document.body.classList.remove("right-panel-open");
      if (wasAtBottom) {
        timeline.scrollTop = timeline.scrollHeight;
        _stickyToBottom = true;
        updateScrollBtn();
      }
      dpDisconnectGitObserver();
      dpSyncPinnedSummaryStrip();
      syncPanelState();
    };
    const toggleDesktopRightPanel = () => {
      if (dpPanelOpen) closeDesktopRightPanel();
      else openDesktopRightPanel();
    };
    const dpStopPanelResize = ({ persist = false } = {}) => {
      if (!_desktopRightPanelResizeState) return;
      _desktopRightPanelResizeState = null;
      document.body.classList.remove("desktop-right-panel-resizing");
      if (persist) dpPersistPanelWidthAtDefaultTextSize();
    };
    const dpHandlePanelResizeMove = (event) => {
      if (!_desktopRightPanelResizeState || !dpPanelOpen) return;
      const nextWidth = _desktopRightPanelResizeState.startWidth + (_desktopRightPanelResizeState.startX - event.clientX);
      dpPanelWidthAtDefaultTextSize = dpClampPanelWidthAtDefaultTextSize(dpUnscalePanelWidth(nextWidth));
      dpApplyPanelWidth();
      syncPanelState();
    };
    dpSplitDivider?.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      _dpSplitDragging = true;
      dpSplitDivider.setPointerCapture(e.pointerId);
      document.body.classList.add("dp-split-resizing");
    });
    dpSplitDivider?.addEventListener("pointermove", (e) => {
      if (!_dpSplitDragging || !dpGitContent || !dpSplitPanel) return;
      const rect = dpSplitPanel.getBoundingClientRect();
      let newH = e.clientY - rect.top;
      newH = Math.max(0, Math.min(rect.height, newH));
      dpGitContent.style.height = `${newH}px`;
      _dpSplitGitHeightPx = newH;
    });
    dpSplitDivider?.addEventListener("pointerup", () => {
      _dpSplitDragging = false;
      document.body.classList.remove("dp-split-resizing");
    });
    dpSplitDivider?.addEventListener("pointercancel", () => {
      _dpSplitDragging = false;
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
    let dpFileContextPaths = [];
    let dpFileContextTriggerPath = "";
    let dpWorkspaceRoot = "";
    const dpOpenFileContextMenu = (rawPathOrPaths, event, { openFile = false, triggerPath = "" } = {}) => {
      const paths = (Array.isArray(rawPathOrPaths) ? rawPathOrPaths : [rawPathOrPaths])
        .map(normalizeWorkspaceFilePath)
        .filter(Boolean);
      if (!paths.length) return;
      event.preventDefault();
      event.stopPropagation();
      dpFileContextPaths = paths;
      dpFileContextTriggerPath = normalizeWorkspaceFilePath(triggerPath) || paths[0];
      window.parent?.postMessage({
        type: "show-file-context-menu",
        payload: {
          x: Math.round(Number(event.clientX) || 0),
          y: Math.round(Number(event.clientY) || 0),
          openFile,
        },
      }, "*");
    };
    let dpCommitContextHash = "";
    const dpOpenCommitContextMenu = (hash, event) => {
      event.preventDefault();
      event.stopPropagation();
      dpCommitContextHash = hash;
      window.parent?.postMessage({
        type: "show-commit-context-menu",
        payload: { x: Math.round(Number(event.clientX) || 0), y: Math.round(Number(event.clientY) || 0) },
      }, "*");
    };
    const dpLoadWorkspaceRoot = async () => {
      if (!dpWorkspaceRoot) {
        const response = await fetchWithTimeout("/room-state", {}, 4000);
        if (!response.ok) throw new Error("Failed to read workspace path.");
        const state = await response.json();
        dpWorkspaceRoot = String(state?.workspace || "").replace(/\/+$/, "");
        if (!dpWorkspaceRoot) throw new Error("Workspace path is unavailable.");
      }
      return dpWorkspaceRoot;
    };
    const dpCopyFilePath = async (paths, absolute) => {
      if (absolute || paths.some((path) => String(path).startsWith("/"))) await dpLoadWorkspaceRoot();
      const text = paths.map((p) => {
        const path = normalizeWorkspaceFilePath(p);
        if (absolute) return path.startsWith("/") ? path : `${dpWorkspaceRoot}/${path}`;
        return path.startsWith(`${dpWorkspaceRoot}/`) ? path.slice(dpWorkspaceRoot.length + 1) : path;
      }).join("\n");
      await doCopyText(text);
      setStatus("Copied path");
    };
    const dpCopyFiles = async (paths) => {
      const normalized = paths.map(normalizeWorkspaceFilePath).filter(Boolean);
      const root = normalized.some((path) => !path.startsWith("/")) ? await dpLoadWorkspaceRoot() : "";
      const absolutePaths = normalized.map((path) => {
        return path.startsWith("/") ? path : `${root}/${path}`;
      });
      window.parent?.postMessage({ type: "copy-files-to-clipboard", paths: absolutePaths }, "*");
    };
    const dpRevealFileInFinder = async (path) => {
      const response = await fetchWithTimeout("/reveal-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      }, 12000);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Reveal failed");
      }
    };
    const dpQuickLookPaths = async (paths) => {
      try {
        const response = await fetchWithTimeout("/quick-look", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths }),
        }, 8000);
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data?.error || "Quick Look failed");
        }
      } catch (err) {
        setStatus(err?.message || "Quick Look failed");
      }
    };
    function handleDesktopCommitContextMenuAction(payload) {
      const action = String(payload?.action || "");
      if (!["copyCommitHash", "copyCommitMessage"].includes(action)) return false;
      const hash = dpCommitContextHash;
      if (!hash) return true;
      void (async () => {
        const info = await gitCommitInfo(hash);
        await doCopyText(action === "copyCommitHash" ? info.hash : info.message);
        setStatus(action === "copyCommitHash" ? "Copied hash" : "Copied message");
      })().catch((err) => {
        setStatus(err?.message || "Commit action failed");
      });
      return true;
    }
    function handleDesktopFileContextMenuAction(payload) {
      const action = String(payload?.action || "");
      if (!["openFile", "quickLook", "revealFileInFinder", "copyFiles", "copyAbsoluteFilePath", "copyRelativeFilePath"].includes(action)) return false;
      const paths = dpFileContextPaths;
      if (!paths.length) return true;
      const operation = action === "openFile"
        ? dpPostOpenFile(dpFileContextTriggerPath || paths[0])
        : action === "quickLook"
          ? dpQuickLookPaths(paths)
          : action === "revealFileInFinder"
            ? dpRevealFileInFinder(dpFileContextTriggerPath || paths[0])
            : action === "copyFiles"
              ? dpCopyFiles(paths)
              : dpCopyFilePath(paths, action === "copyAbsoluteFilePath");
      void operation.catch((err) => {
        setStatus(err?.message || "File action failed");
      });
      return true;
    }
    const dpChevronIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
    const dpBackIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>';
    const dpRootIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="12 6 6 12 12 18"/><polyline points="19 6 13 12 19 18"/></svg>';
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
      btn.dataset.path = entry.path;
      const iconEl = fileIconElement(entry.path, { isDir }, "repo-browser-item-icon");
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
          const path = entry.path;
          if (e.shiftKey) { dpRepoSel.selectRangeTo(path); return; }
          if (e.metaKey) { dpRepoSel.toggle(path); return; }
          void dpLoadRepoDir(path);
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
          const resolved = dpResolveRowClick(dpRepoSel, entry.path, e);
          if (!resolved) return;
          const fileSet = dpRepoFilePathSet();
          const targets = resolved.targets.filter((p) => fileSet.has(p));
          if (!targets.length) return;
          if (resolved.quickLook) {
            await dpQuickLookPaths(targets);
            return;
          }
          for (const p of targets) {
            await openFileSurface(p, fileExtForPath(p), btn, e);
          }
        });
      }
      btn.addEventListener("contextmenu", (e) => {
        void dpOpenFileContextMenu(dpResolveContextMenuTargets(dpRepoSel, entry.path), e, { triggerPath: entry.path });
      });
      return btn;
    };
    const dpRepoEntriesStructureSignature = (entries) =>
      (entries || []).map((entry) => `${entry.kind}:${entry.path}`).join("\n");
    const dpRenderRepoPanel = (rawPath, entries, { loading = false, error = "", direction = "none" } = {}) => {
      if (!dpRepoContent) return;
      const path = dpNormalizePath(rawPath);
      const pathParts = path.split("/").filter(Boolean);
      const parentPath = pathParts.slice(0, -1).join("/");
      const pathBasename = pathParts[pathParts.length - 1] || "/";
      const isSamePath = path === dpRepoBrowserPath;
      const previousScrollTop = isSamePath
        ? dpRepoContent.querySelector(".repo-browser-scroll")?.scrollTop || 0
        : 0;
      const rowKey = (el) => el.title || "";
      const firstRects = direction === "none" && !loading && !error
        ? captureListRowRects(dpRepoContent, ".repo-browser-item", rowKey)
        : null;
      dpRepoBrowserPath = path;
      if (!isSamePath) dpRepoSel.clear();
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
      pathRow.title = path ? "Parent folder" : "Root";
      pathRow.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!path) return;
        void dpLoadRepoDir(parentPath);
      });
      pathRow.addEventListener("keydown", (e) => {
        if (!path || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault(); e.stopPropagation();
        void dpLoadRepoDir(parentPath);
      });
      const backIcon = document.createElement("span");
      backIcon.className = "repo-path-back-icon-slot";
      backIcon.innerHTML = dpBackIcon;
      const pathText = document.createElement("span");
      pathText.className = "repo-path-label";
      pathText.textContent = pathBasename;
      pathRow.append(backIcon, pathText);
      if (path) {
        const rootBtn = document.createElement("span");
        rootBtn.className = "repo-path-root-btn";
        rootBtn.setAttribute("role", "button");
        rootBtn.title = "Root";
        rootBtn.innerHTML = dpRootIcon;
        rootBtn.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          void dpLoadRepoDir("");
        });
        pathRow.append(rootBtn);
      }
      pathWrap.appendChild(pathRow);
      pathWrap.addEventListener("contextmenu", (e) => {
        void dpOpenFileContextMenu(path, e);
      });
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
        const node = document.createElement("button");
        node.type = "button";
        node.className = "repo-browser-empty error";
        node.textContent = error;
        node.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void dpLoadRepoDir(path);
        });
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
      scroll.scrollTop = previousScrollTop;
      flipListRows(dpRepoContent, ".repo-browser-item", rowKey, firstRects);
      dpRepoSel.prune();
      dpRepoSel.applyClasses();
      scroll.addEventListener("mousedown", (e) => {
        if (e.target === scroll || e.target === list) dpRepoSel.clear();
      });
    };
    const dpLoadRepoDir = async (rawPath, { animate = true } = {}) => {
      if (!dpPanelOpen) return;
      const path = dpNormalizePath(rawPath);
      const currentDepth = dpRepoBrowserPath.split("/").filter(Boolean).length;
      const newDepth = path.split("/").filter(Boolean).length;
      const direction = !animate
        ? "none"
        : newDepth > currentDepth
          ? "forward"
          : newDepth < currentDepth
            ? "back"
            : "none";
      const loadSeq = ++dpRepoLoadSeq;
      const repoLoadCancelled = () => loadSeq !== dpRepoLoadSeq || !dpPanelOpen;
      cancelDpRepoLoading();
      cancelDpRepoLoading = startDelayedLoading(
        () => dpRenderRepoPanel(path, [], { loading: true, direction }),
        repoLoadCancelled,
      );
      try {
        const [entries] = await Promise.all([
          dpFetchRepoDir(path),
          ensureFileIconTheme(),
        ]);
        cancelDpRepoLoading();
        if (repoLoadCancelled()) return;
        dpRenderRepoPanel(path, entries, { direction });
      } catch (err) {
        cancelDpRepoLoading();
        if (repoLoadCancelled()) return;
        dpRenderRepoPanel(path, [], { error: err?.message || "Failed to load directory", direction });
      }
    };
    const dpRefreshRepoDir = async (rawPath) => {
      if (!dpPanelOpen || !dpRepoContent?.querySelector(".repo-browser-stack")) return;
      const path = dpNormalizePath(rawPath);
      try {
        const [entries] = await Promise.all([
          dpFetchRepoDir(path),
          ensureFileIconTheme(),
        ]);
        if (!dpPanelOpen || dpActivePanelView !== "repo" || dpNormalizePath(dpRepoBrowserPath) !== path) return;
        const currentEntries = Array.from(dpRepoContent.querySelectorAll(".repo-browser-item")).map((item) => ({
          kind: item.classList.contains("repo-browser-dir") ? "dir" : "file",
          path: dpNormalizePath(item.title || ""),
        }));
        if (dpRepoEntriesStructureSignature(currentEntries) === dpRepoEntriesStructureSignature(entries)) return;
        dpRenderRepoPanel(path, entries, { direction: "none" });
      } catch (_) {}
    };
    window.addEventListener("message", (event) => {
      if (!event.data) return;
      if (event.data.type === "hub-theme-changed") {
        const roomTheme = event.data.roomTheme || event.data.theme;
        document.documentElement.dataset.theme = roomTheme === "light" ? "light" : "dark";
        const themeDesktop = event.data.themeDesktop;
        if (themeDesktop) {
          document.documentElement.dataset.themeDesktop = themeDesktop;
        } else {
          delete document.documentElement.dataset.themeDesktop;
        }
        const url = new URL(window.location.href);
        url.searchParams.set("theme", document.documentElement.dataset.theme);
        if (themeDesktop) url.searchParams.set("theme_desktop", themeDesktop);
        history.replaceState(history.state, "", url.toString());
        return;
      }
      if (event.data.type === "hub-text-size-changed") {
        const px = Number(event.data.textSize);
        if (Number.isFinite(px)) {
          document.documentElement.style.setProperty("--text-size", `${px}px`);
          if (isComposerOverlayOpen()) {
            autoResizeTextarea();
            if (document.documentElement.dataset.nativeApp !== "1") {
              requestAnimationFrame(() => reportFitHeight({ fromComposer: true }));
            }
          }
          dpApplyPanelWidth();
          syncPanelState();
          const url = new URL(window.location.href);
          url.searchParams.set("text_size", String(px));
          history.replaceState(history.state, "", url.toString());
        }
        return;
      }
      if (event.data.type === "hub-fit-collapsed") {
        _fitCollapsed = !!event.data.on;
        if (_fitCollapsed && typeof isComposerOverlayOpen === "function" && isComposerOverlayOpen()) {
          closeComposerOverlay();
        }
        return;
      }
      if (event.data.type === "hub-refit") {
        _fitTargetRow = null;
        _stickyToBottom = true;
        requestAnimationFrame(() => reportFitHeight({ restore: true }));
        return;
      }
      if (event.data.type === "hub-auto-window-height") {
        _fitTargetRow = null;
        document.documentElement.dataset.autoWindowHeight = event.data.on ? "1" : "0";
        syncMainAfterHeight();
        dpSyncPinnedSummaryStrip();
        if (event.data.on) {
          requestAnimationFrame(reportFitHeight);
        } else {
          _stickyToBottom = true;
          requestAnimationFrame(() => scrollConversationToBottom("auto"));
        }
        return;
      }
      if (event.data.type === "desktop-panel-sync-request") {
        syncPanelState();
        return;
      }
      if (event.data.type === "file-context-menu-error") {
        setStatus(String(event.data.message || "File menu failed"));
        return;
      }
      if (event.data.type === "file-copy-result") {
        setStatus(event.data.error ? String(event.data.error) : "Copied file");
        return;
      }
      if (event.data.type === "desk-git-changes-request") {
        (async () => {
          let files = [];
          let error = false;
          try {
            const loaded = await loadGitDiffFileStats({});
            const byPath = new Map();
            for (const f of (Array.isArray(loaded?.files) ? loaded.files : [])) {
              const p = String(f?.path || "").trim();
              if (!p) continue;
              const cur = byPath.get(p) || { path: p, oldPath: String(f?.old_path || ""), ins: 0, dels: 0, untracked: !!f?.untracked };
              cur.ins += Number(f?.ins) || 0;
              cur.dels += Number(f?.dels) || 0;
              cur.untracked = cur.untracked || !!f?.untracked;
              byPath.set(p, cur);
            }
            files = Array.from(byPath.values());
          } catch (_) { error = true; }
          window.parent?.postMessage({ type: "desk-git-changes", files, error }, "*");
        })();
        return;
      }
      if (event.data.type === "desk-open-git-file") {
        const p = String(event.data.path || "").trim();
        if (p) {
          if (event.data.untracked) void dpPostOpenFile(p);
          else void dpPostOpenDiff(p, "", String(event.data.oldPath || ""));
        }
        return;
      }
      if (event.data.type === "toggle-git-pin") {
        dpToggleGitSummaryPinned();
        return;
      }
      if (event.data.type === "desktop-room-reset") {
        closeDesktopRightPanel();
        _pollScrollLockTop = null;
        _pollScrollAnchor = null;
        _stickyToBottom = true;
        let frames = 6;
        const settleToBottom = () => {
          scrollConversationToBottom("auto");
          _stickyToBottom = true;
          if (--frames > 0) requestAnimationFrame(settleToBottom);
        };
        settleToBottom();
        return;
      }
      if (event.data.type !== "desktop-panel") return;
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
      window.focus();
    });
    (() => {
      window.addEventListener("keydown", (event) => {
        if (event.metaKey && event.altKey) {
          if (event.code === "KeyB") {
            event.preventDefault();
            window.parent?.postMessage({ type: "toggle-hub-sidebar-outward" }, "*");
            return;
          }
          if (event.code === "KeyE") {
            event.preventDefault();
            window.parent?.postMessage({ type: "toggle-desktop-panel-outward" }, "*");
            return;
          }
          if (event.code === "KeyT") {
            event.preventDefault();
            window.parent?.postMessage({ type: "desktop-menu-shortcut", action: "openTerminal" }, "*");
            return;
          }
          if (event.code === "KeyL") {
            event.preventDefault();
            void runForwardAction("revealLog");
            return;
          }
          if (event.code === "KeyO" && document.documentElement.dataset.nativeApp === "1") {
            event.preventDefault();
            if (event.shiftKey) window.parent?.postMessage({ type: "desktop-menu-shortcut", action: "openHubInBrowser" }, "*");
            else void runForwardAction("openInBrowser");
            return;
          }
          if (event.code === "KeyR") {
            event.preventDefault();
            const revealTarget = dpActivePanelTargets(
              dpRepoOrderedSelectedFiles, ".repo-browser-file:hover", ".git-commit-file-row:hover",
            ).slice(-1)[0] || "";
            if (revealTarget) {
              void dpRevealFileInFinder(revealTarget).catch((err) => {
                setStatus(err?.message || "Reveal failed");
              });
            } else {
              window.parent?.postMessage({ type: "desktop-menu-shortcut", action: "openFinder" }, "*");
            }
            return;
          }
          if (event.code === "KeyP") {
            event.preventDefault();
            window.parent?.postMessage({ type: "always-on-top-shortcut" }, "*");
            return;
          }
          if (event.code === "KeyH") {
            event.preventDefault();
            window.parent?.postMessage({ type: "auto-window-height-shortcut" }, "*");
            return;
          }
          if (event.code === "KeyM") {
            event.preventDefault();
            window.parent?.postMessage({ type: "fit-collapse-shortcut" }, "*");
            return;
          }
          if (event.code === "Digit0" || event.key === "0") {
            event.preventDefault();
            window.parent?.postMessage({ type: "reset-window-shortcut" }, "*");
            return;
          }
          if (event.code === "Digit9" || event.key === "9") {
            event.preventDefault();
            window.parent?.postMessage({ type: "compact-window-shortcut" }, "*");
            return;
          }
          if (event.code === "Digit8" || event.key === "8") {
            event.preventDefault();
            window.parent?.postMessage({ type: "mini-window-shortcut" }, "*");
            return;
          }
          if (event.code === "ArrowUp") {
            event.preventDefault();
            window.parent?.postMessage({ type: "move-window-shortcut", command: "move_window_top" }, "*");
            return;
          }
          if (event.code === "ArrowLeft") {
            event.preventDefault();
            window.parent?.postMessage({ type: "move-window-shortcut", command: "move_window_top_left" }, "*");
            return;
          }
          if (event.code === "ArrowRight") {
            event.preventDefault();
            window.parent?.postMessage({ type: "move-window-shortcut", command: "move_window_top_right" }, "*");
            return;
          }
          if (event.code === "ArrowDown") {
            event.preventDefault();
            window.parent?.postMessage({ type: "move-window-shortcut", command: "move_window_center" }, "*");
            return;
          }
        }
        if (event.metaKey && event.code === "Comma") {
          event.preventDefault();
          window.parent?.postMessage({ type: "desktop-menu-shortcut", action: "openAppearanceMenu" }, "*");
          return;
        }
        if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && event.code === "Period") {
          event.preventDefault();
          window.parent?.postMessage({ type: "desktop-menu-shortcut", action: "openRoomHeaderMenu" }, "*");
          return;
        }
        if (event.metaKey && !event.altKey && event.code === "KeyB") {
          event.preventDefault();
          window.parent?.postMessage({ type: "toggle-hub-sidebar" }, "*");
          return;
        }
        if (event.metaKey && !event.altKey && event.code === "KeyE") {
          event.preventDefault();
          if (document.documentElement.dataset.autoWindowHeight === "1") {
            window.parent?.postMessage({ type: "toggle-desktop-right-panel" }, "*");
          } else {
            toggleDesktopRightPanel();
          }
          return;
        }
        if (event.metaKey && !event.altKey && !event.shiftKey && !event.ctrlKey && event.code === "KeyT") {
          event.preventDefault();
          window.parent?.postMessage({ type: "desktop-menu-shortcut", action: "openShell" }, "*");
          return;
        }
        if (event.metaKey && !event.altKey && !event.ctrlKey && event.code === "KeyR") {
          event.preventDefault();
          window.parent?.postMessage({ type: "reload-shortcut", scope: event.shiftKey ? "hub" : "room" }, "*");
          return;
        }
        if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && event.code === "KeyN") {
          event.preventDefault();
          window.parent?.postMessage({ type: "new-timeline-shortcut" }, "*");
          return;
        }
        if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && /^Digit[1-9]$/.test(event.code || "")) {
          event.preventDefault();
          window.parent?.postMessage({ type: "switch-timeline-shortcut", index: Number(event.code.slice(5)) - 1 }, "*");
          return;
        }
        if (event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey && event.code === "KeyP") {
          event.preventDefault();
          dpToggleGitSummaryPinned();
          return;
        }
        if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && event.code === "KeyO") {
          const targets = dpActivePanelTargets(
            dpRepoOrderedSelectedFiles, ".repo-browser-file:hover", ".git-commit-file-row:hover",
          );
          if (targets.length) {
            event.preventDefault();
            for (const p of targets) void dpPostOpenFile(p);
          }
          return;
        }
        if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && event.code === "KeyY") {
          const targets = dpActivePanelTargets(
            dpRepoOrderedSelectedFiles, ".repo-browser-file:hover", ".git-commit-file-row:hover",
          );
          if (targets.length) {
            event.preventDefault();
            void dpQuickLookPaths(targets);
          }
          return;
        }
        if (event.metaKey && event.altKey && !event.ctrlKey && event.code === "KeyC") {
          const targets = dpActivePanelTargets(
            dpRepoOrderedSelectedEntries, ".repo-browser-item:hover", ".git-commit-file-row:hover",
          );
          if (targets.length) {
            event.preventDefault();
            void dpCopyFilePath(targets, !event.shiftKey).catch((err) => {
              setStatus(err?.message || "Copy failed");
            });
          }
          return;
        }
        if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && event.code === "KeyC") {
          const target = event.target;
          if (target instanceof Element && (target.closest("input, textarea") || target.isContentEditable)) return;
          if (window.getSelection()?.toString()) return;
          if (document.documentElement.dataset.nativeApp !== "1") return;
          const targets = dpActivePanelTargets(
            dpRepoOrderedSelectedEntries, ".repo-browser-item:hover", ".git-commit-file-row:hover",
          );
          if (targets.length) {
            event.preventDefault();
            void dpCopyFiles(targets).catch((err) => {
              setStatus(err?.message || "Copy failed");
            });
          }
          return;
        }
        if (!event.metaKey || event.ctrlKey) return;
        if (event.code === "Equal" || event.code === "Semicolon" || event.key === "=" || event.key === "+") {
          event.preventDefault();
          window.parent?.postMessage({ type: "text-size-shortcut", delta: 1 }, "*");
        } else if (event.code === "Minus" || event.key === "-" || event.key === "_") {
          event.preventDefault();
          window.parent?.postMessage({ type: "text-size-shortcut", delta: -1 }, "*");
        } else if (event.code === "Digit0" || event.key === "0") {
          event.preventDefault();
          window.parent?.postMessage({ type: "text-size-shortcut", reset: true }, "*");
        }
      }, true);
    })();
    const handleWorkspaceFilesChanged = () => {
      if (dpPanelOpen && dpActivePanelView === "repo") {
        void dpRefreshRepoDir(dpRepoBrowserPath || "");
      }
    };
    const handleWorkspaceGitChanged = () => {
      gitPanel.invalidateFingerprint();
      if (!dpPanelOpen && !dpPinnedStripActive()) return;
      if (dpPanelOpen && !gitPanel.hasShell()) {
        void dpLoadGitPage({ reset: true });
      } else {
        void dpRefreshGitOverview();
      }
    };
    __INCLUDE:../room-events.js__
    dpOnTimelineSummaryPinReload({ force: true });
    dpApplyPanelWidth();
    refresh({ forceScroll: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        void refresh();
      }
    });
