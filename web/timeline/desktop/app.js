__INCLUDE:../base.js__
__INCLUDE:../link-presentation.js__
    let _scrollbarLayoutSyncFrame = 0;
    let _fitTargetRow = null;
    let _fitCollapsed = false;
    const syncTimelineScrollbarLayoutWidth = () => {
      const mainEl = document.querySelector("main");
      if (!mainEl || document.documentElement.dataset.mobile === "1") return;
      const width = Math.max(0, mainEl.offsetWidth - mainEl.clientWidth);
      const next = `${width}px`;
      if (mainEl.style.getPropertyValue("--timeline-scrollbar-layout-width") !== next) {
        mainEl.style.setProperty("--timeline-scrollbar-layout-width", next);
      }
    };
    const scheduleTimelineScrollbarLayoutWidthSync = () => {
      if (_scrollbarLayoutSyncFrame) return;
      _scrollbarLayoutSyncFrame = requestAnimationFrame(() => {
        _scrollbarLayoutSyncFrame = 0;
        syncTimelineScrollbarLayoutWidth();
      });
    };
    const mainScrollbarEl = document.querySelector("main");
    if (mainScrollbarEl && typeof ResizeObserver === "function") {
      new ResizeObserver(scheduleTimelineScrollbarLayoutWidthSync).observe(mainScrollbarEl);
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
    scheduleTimelineScrollbarLayoutWidthSync();
    window.addEventListener("pageshow", () => syncAppShellHeight());
    window.addEventListener("resize", () => {
      syncAppShellHeight();
      scheduleTimelineScrollbarLayoutWidthSync();
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
    const messagesEl = document.getElementById("messages");
    wireLinkPresentation(messagesEl);
    let _pollScrollLockTop = null;
    let _pollScrollAnchor = null;
    let _hubChromeGapClientMin = Infinity;
    let _hubChildOriW = 0;
    let _hubChildOriH = 0;
    const isHubIframeTimeline = () =>
      document.documentElement.dataset.hubIframeTimeline === "1" ||
      document.documentElement.dataset.hubShell === "1" ||
      window.parent !== window;
    const requestHubParentLayout = () => {
      if (!isHubIframeTimeline()) return;
      window.parent.postMessage({ type: "timeline-request-hub-layout" }, "*");
    };
    const notifyHubTimelineRenderReady = () => {
      if (!isHubIframeTimeline()) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.parent.postMessage({ type: "timeline-render-ready" }, "*");
        });
      });
    };
    const notifyHubTimelineRenderError = () => {
      if (!isHubIframeTimeline()) return;
      window.parent.postMessage({ type: "timeline-render-error" }, "*");
    };
    if (isHubIframeTimeline()) {
      document.documentElement.dataset.hubIframeTimeline = "1";
      _hubChildOriW = window.innerWidth || 0;
      _hubChildOriH = window.innerHeight || 0;
      window.addEventListener("message", (e) => {
        if (!e.data || e.data.type !== "hub-layout") return;
        if (e.source !== window.parent) return;
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
      window.addEventListener("resize", hubChildResizeChrome, { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", hubChildResizeChrome);
        window.visualViewport.addEventListener("scroll", () => {
          hubPingParentForSafariChrome();
        });
      }
      messagesEl.addEventListener("scroll", hubPingParentForSafariChrome, { passive: true });
      requestHubParentLayout();
    }

    const FIT_COMPOSER_BASE_HEIGHT = 275 / 13;
    const FIT_SIDEBAR_HEIGHT_SCALE = 1.8;
    const reportFitHeight = ({ fromComposer = false, restore = false, preservePosition = false } = {}) => {
      if (!isHubIframeTimeline() || document.documentElement.dataset.autoWindowHeight !== "1") return;
      const scroller = messagesEl;
      const rows = scroller
        ? scroller.querySelectorAll(":scope > article.message-row, :scope > .sysmsg-row")
        : null;
      const composerOpen = isComposerOverlayOpen();
      const sidebarOpen = document.body.classList.contains("side-bar-open");
      if ((!rows || !rows.length) && !composerOpen && !sidebarOpen) return;
      const fitTarget = _fitTargetRow?.isConnected && _fitTargetRow.parentElement === scroller
        ? _fitTargetRow
        : null;
      if (_fitTargetRow && !fitTarget) _fitTargetRow = null;
      let contentHeight;
      const textSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-size"));
      const sidebarMinimumContentHeight = sidebarOpen
        ? Math.ceil(textSize * FIT_COMPOSER_BASE_HEIGHT * FIT_SIDEBAR_HEIGHT_SCALE)
        : 0;
      if (composerOpen) {
        const input = document.getElementById("message");
        const inputSpareHeight = parseFloat(getComputedStyle(input).maxHeight) - input.offsetHeight;
        const aboveInput = document.querySelector(".composer-above-input");
        const aboveInputHeight = aboveInput.offsetHeight ? -aboveInput.offsetTop : 0;
        contentHeight = Math.ceil(textSize * FIT_COMPOSER_BASE_HEIGHT + Math.max(0, aboveInputHeight - inputSpareHeight));
      } else if (fitTarget) {
        const r = fitTarget.getBoundingClientRect();
        contentHeight = Math.ceil(r.bottom - r.top + messageStepTopGap()) + messageStepTopGap();
      } else if (rows?.length) {
        const lastRow = rows[rows.length - 1];
        const lastTopWithin = lastRow.getBoundingClientRect().top
          - scroller.getBoundingClientRect().top + scroller.scrollTop;
        contentHeight = Math.ceil(scroller.scrollHeight - lastTopWithin) + messageStepTopGap();
      } else {
        contentHeight = sidebarMinimumContentHeight;
      }
      contentHeight = Math.max(contentHeight, sidebarMinimumContentHeight);
      if (contentHeight > 0) {
        if (!preservePosition && !fromComposer && fitTarget) {
          _stickyToBottom = false;
          _programmaticScroll = true;
          positionConversationRowAtStepTop(fitTarget, "auto");
          requestAnimationFrame(() => { _programmaticScroll = false; });
        } else if (!preservePosition && !fromComposer) {
          _stickyToBottom = true;
          scrollConversationToBottom("auto");
        }
        window.parent.postMessage({ type: "fit-window-height", contentHeight, restore }, "*");
      }
    };
    const fitMessageRows = () => [...messagesEl.querySelectorAll(":scope > article.message-row")];
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
    const fitStepToMessage = async (down, senders = null) => {
      const anchor = _fitTargetRow?.isConnected ? _fitTargetRow : null;
      let next = findStepTarget(stepRows(senders), down, anchor);
      if (down) {
        if (!next && senders) return;
        const allRows = fitMessageRows();
        if (!next || next === allRows[allRows.length - 1]) { fitStepToLatest(); return; }
      } else {
        if (!next && senders) next = await findOlderStepTarget(senders, anchor);
        if (!next) return;
      }
      _fitTargetRow = next;
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
      _stickyToBottom = false;
      reportFitHeight();
    };
    document.addEventListener("timeline-transcript-settled", () => {
      if (_fitCollapsed) { _fitTargetRow = null; _stickyToBottom = true; }
      reportFitHeight({ restore: true });
    });
    let _thinkingRefitFrame = 0;
    document.addEventListener("timeline-thinking-updated", () => {
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
    document.addEventListener("timeline-send-failed", () => {
      if (document.documentElement.dataset.autoWindowHeight !== "1") return;
      requestAnimationFrame(() => reportFitHeight());
    });
__INCLUDE:../scroll-focus.js__
__INCLUDE:file-open.js__
__INCLUDE:../composer-overlay.js__
__INCLUDE:../message-step.js__
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
    let _timelineLayoutWidth = messagesEl.clientWidth;
    let _widthChangeSequence = 0;
    new ResizeObserver(() => {
      const width = messagesEl.clientWidth;
      const prevWidth = _timelineLayoutWidth;
      _timelineLayoutWidth = width;
      if (width === prevWidth) return;
      const sequence = ++_widthChangeSequence;
      const wasAtBottom = _atBottomAtAnchorWidth;
      const centerAnchor = _viewportCenterAnchor || captureViewportCenterAnchor();
      _pinStickyThroughWidthChange = true;
      const apply = (remaining) => {
        if (sequence !== _widthChangeSequence) return;
        if (wasAtBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
        else restoreViewportCenterAnchor(centerAnchor);
        if (remaining <= 0) {
          _pinStickyThroughWidthChange = false;
          _anchorLayoutWidth = messagesEl.clientWidth;
          refreshViewportCenterAnchor();
          _stickyToBottom = isNearBottom();
          updateScrollBtn();
          return;
        }
        requestAnimationFrame(() => apply(remaining - 1));
      };
      apply(2);
    }).observe(messagesEl);

    {
      const header = document.querySelector(".page-header");
      if (header) header.classList.remove("header-hidden");
      messagesEl.addEventListener("scroll", () => {
        if (header?.classList.contains("header-hidden")) {
          header.classList.remove("header-hidden");
        }
      }, { passive: true });
    }

__INCLUDE:../messages.js__
__INCLUDE:../transcript-render.js__
    if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
      const rerenderWhenMarkdownReady = () => {
        if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") rerenderCurrentMessages({ suppressEntryAnimation: true });
      };
      window.addEventListener("DOMContentLoaded", rerenderWhenMarkdownReady, { once: true });
      window.addEventListener("load", rerenderWhenMarkdownReady, { once: true });
    }
__INCLUDE:../transcript-actions.js__
__INCLUDE:menu.js__
__INCLUDE:header-actions.js__
__INCLUDE:../export.js__
__INCLUDE:../composer.js__
__INCLUDE:../file-links.js__
__INCLUDE:../composer-commands.js__
__INCLUDE:../thinking.js__
__INCLUDE:../agent-status.js__
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent || event.data?.type !== "refresh-timeline-state") return;
      void refreshTimelineState();
    });
__INCLUDE:../pointer-capability.js__
    const sideBar = document.getElementById("sideBar");
    const sideBarResizer = document.getElementById("sideBarResizer");
    const splitPanel = document.getElementById("splitPanel");
    const splitDivider = document.getElementById("splitDivider");
    const repoContent = document.getElementById("repoContent");
    const gitContent = document.getElementById("gitContent");
    const TEXT_SIZE_DEFAULT = __TEXT_SIZE_DEFAULT__;
    const SIDE_BAR_DEFAULT_WIDTH_AT_DEFAULT_TEXT_SIZE = 220;
    const SIDE_BAR_MIN_WIDTH_AT_DEFAULT_TEXT_SIZE = 144;
    const SIDE_BAR_MAX_WIDTH_AT_DEFAULT_TEXT_SIZE = 560;
    const SIDE_BAR_WIDTH_KEY = "agent_window_desktop_side_bar_width_at_default_text_size";
    const SIDE_BAR_POSITION_KEY = "agent_window_desktop_side_bar_position";
    if (localStorage.getItem(SIDE_BAR_POSITION_KEY) === "left") document.documentElement.dataset.sideBarPosition = "left";
    const GIT_REPO_POSITION_KEY = "agent_window_desktop_git_repo_position";
    if (localStorage.getItem(GIT_REPO_POSITION_KEY) === "repo-top") document.documentElement.dataset.gitRepoPosition = "repo-top";
    const SIDE_BAR_GAP = 0;
    let sideBarOpen = false;
    let activeSideBarView = "repo";
    let repoBrowserPath = "";
    let repoLoadSeq = 0;
    let cancelDpRepoLoading = () => {};
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
    const resolveRowClick = (sel, path, event) => {
      if (event.shiftKey) { sel.selectRangeTo(path); return null; }
      if (event.metaKey) { sel.toggle(path); return null; }
      const isMulti = sel.selected.size > 1 && sel.selected.has(path);
      const targets = isMulti ? sel.orderedSelected() : [path];
      if (!isMulti) sel.set([path]);
      return { targets, quickLook: event.altKey };
    };
    const resolveContextMenuTargets = (sel, path) => {
      if (!(sel.selected.size > 1 && sel.selected.has(path))) sel.set([path]);
      return sel.orderedSelected();
    };
    const repoSel = createRowSelection({ container: repoContent, rowSelector: ".repo-browser-item" });
    const repoFilePathSet = () => new Set(Array.from(repoContent?.querySelectorAll(".repo-browser-file") || []).map((el) => el.dataset.path || ""));
    const repoOrderedSelectedFiles = () => repoSel.orderedSelected().filter((p) => repoFilePathSet().has(p));
    const repoOrderedSelectedEntries = () => repoSel.orderedSelected();
    const gitSel = createRowSelection({ container: gitContent, rowSelector: ".git-commit-file-row" });
    const gitOrderedSelectedFiles = () => gitSel.orderedSelected();
    const activeSideBarTargets = (repoOrdered, repoHoverSel, gitHoverSel) => {
      if (!sideBarOpen) return [];
      let repoTargets = repoOrdered();
      if (!repoTargets.length) {
        const hovered = repoContent?.querySelector(repoHoverSel);
        if (hovered?.dataset.path) repoTargets = [hovered.dataset.path];
      }
      if (repoTargets.length) return repoTargets;
      let gitTargets = gitOrderedSelectedFiles();
      if (!gitTargets.length) {
        const hovered = gitContent?.querySelector(gitHoverSel);
        if (hovered?.dataset.path) gitTargets = [hovered.dataset.path];
      }
      return gitTargets;
    };
    let sideBarWidthAtDefaultTextSize = SIDE_BAR_DEFAULT_WIDTH_AT_DEFAULT_TEXT_SIZE;
    let _sideBarResizeState = null;
    let _splitDragging = false;
    let _splitGitHeightInTextSize = null;
    const roundSideBarWidth = (value) => Math.round(value * 100) / 100;
    const currentTextSizePx = () => {
      const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-size"));
      return Number.isFinite(raw) && raw > 0 ? raw : TEXT_SIZE_DEFAULT;
    };
    const applySplitGitHeight = () => {
      gitContent.style.height = `calc(var(--text-size) * ${_splitGitHeightInTextSize})`;
    };
    const setSplitGitHeight = (px) => {
      _splitGitHeightInTextSize = px / currentTextSizePx();
      applySplitGitHeight();
    };
    const syncSplitGitHeightForMode = () => {
      if (!gitContent || !splitPanel) return;
      if (document.documentElement.dataset.autoWindowHeight === "1") {
        gitContent.style.height = "50%";
      } else if (_splitGitHeightInTextSize !== null) {
        applySplitGitHeight();
      } else {
        requestAnimationFrame(() => {
          if (!sideBarOpen || document.documentElement.dataset.autoWindowHeight === "1" || _splitGitHeightInTextSize !== null) return;
          const panelH = splitPanel.getBoundingClientRect().height;
          if (panelH > 0) setSplitGitHeight(Math.floor(panelH * 0.5));
        });
      }
    };
    const scaleSideBarWidth = (value) => (
      roundSideBarWidth(Number(value) * currentTextSizePx() / TEXT_SIZE_DEFAULT)
    );
    const unscaleSideBarWidth = (value) => (
      roundSideBarWidth(Number(value) * TEXT_SIZE_DEFAULT / currentTextSizePx())
    );
    const clampSideBarWidthAtDefaultTextSize = (value) => {
      const numeric = Number(value);
      const width = Number.isFinite(numeric) ? numeric : SIDE_BAR_DEFAULT_WIDTH_AT_DEFAULT_TEXT_SIZE;
      return roundSideBarWidth(Math.max(SIDE_BAR_MIN_WIDTH_AT_DEFAULT_TEXT_SIZE, Math.min(SIDE_BAR_MAX_WIDTH_AT_DEFAULT_TEXT_SIZE, width)));
    };
    const storedPanelWidth = Number.parseFloat(localStorage.getItem(SIDE_BAR_WIDTH_KEY) || "");
    if (Number.isFinite(storedPanelWidth) && storedPanelWidth > 0) {
      sideBarWidthAtDefaultTextSize = storedPanelWidth;
    }
    const outwardSideBarWidthPx = () => {
      if (sideBarOpen) return currentSideBarWidthPx();
      return scaleSideBarWidth(clampSideBarWidthAtDefaultTextSize(sideBarWidthAtDefaultTextSize));
    };
    const persistSideBarWidthAtDefaultTextSize = () => {
      if (sideBarWidthAtDefaultTextSize > 0) {
        localStorage.setItem(SIDE_BAR_WIDTH_KEY, String(sideBarWidthAtDefaultTextSize));
      }
    };
    const currentSideBarWidthPx = () => scaleSideBarWidth(
      clampSideBarWidthAtDefaultTextSize(sideBarWidthAtDefaultTextSize),
    );
    const applySideBarWidth = () => {
      const panelWidth = sideBarOpen ? currentSideBarWidthPx() : 0;
      document.documentElement.style.setProperty("--side-bar-width", `${panelWidth}px`);
      document.documentElement.style.setProperty("--side-bar-reserved-width", `${panelWidth > 0 ? panelWidth + SIDE_BAR_GAP : 0}px`);
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
      document.getElementById("sideBarToggle").setAttribute("aria-pressed", sideBarOpen ? "true" : "false");
      if (window.parent !== window) {
        window.parent.postMessage({
          type: "side-bar-state",
          mode: sideBarOpen ? "open" : "",
          view: activeSideBarView,
          width: outwardSideBarWidthPx(),
          side: document.documentElement.dataset.sideBarPosition === "left" ? "left" : "right",
        }, "*");
      }
    };
    window.addEventListener("resize", () => {
      applySideBarWidth();
      syncPanelState();
    });
    const reportSideBarFitHeight = () => {
      if (document.documentElement.dataset.autoWindowHeight !== "1") return;
      requestAnimationFrame(() => reportFitHeight({ restore: true, preservePosition: true }));
    };
    const setSideBarView = (view) => {
      activeSideBarView = view === "git" ? "git" : "repo";
      return activeSideBarView;
    };
    const loadSideBarView = ({ reset = false, animateRepo = true } = {}) => {
      if (!sideBarOpen) return Promise.resolve();
      const hasGitShell = gitPanel.hasShell();
      if (reset && hasGitShell) closeGitDetail();
      const gitP = hasGitShell ? refreshGitOverview() : loadGitPage({ reset: true });
      loadRepoDir(repoBrowserPath || "", { animate: animateRepo });
      return Promise.resolve(gitP);
    };
    const openSideBar = ({ view = null, reset = false } = {}) => {
      if (!sideBar) return Promise.resolve();
      if (view) setSideBarView(view);
      sideBarOpen = true;
      applySideBarWidth();
      syncPinnedSummaryStrip();
      const existingStack = repoContent?.querySelector(".repo-browser-stack");
      if (existingStack) {
        existingStack.classList.remove("repo-browser-nav-forward", "repo-browser-nav-back");
        existingStack.classList.add("repo-browser-nav-none");
      }
      sideBar.hidden = false;
      sideBar.classList.add("open");
      document.body.classList.add("side-bar-open");
      reportSideBarFitHeight();
      syncSplitGitHeightForMode();
      const loadP = loadSideBarView({ reset, animateRepo: false });
      syncPanelState();
      return loadP;
    };
    const closeSideBar = () => {
      if (!sideBar) return;
      const wasAtBottom = _atBottomAtAnchorWidth || messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= 2;
      stopSideBarResize();
      sideBarOpen = false;
      if (gitPanel.hasShell()) closeGitDetail();
      sideBar.classList.remove("open");
      sideBar.hidden = true;
      document.body.classList.remove("side-bar-open");
      reportSideBarFitHeight();
      if (wasAtBottom) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
        _stickyToBottom = true;
        updateScrollBtn();
      }
      disconnectGitObserver();
      syncPinnedSummaryStrip();
      syncPanelState();
    };
    const toggleSideBar = () => {
      if (sideBarOpen) closeSideBar();
      else openSideBar();
    };
    const stopSideBarResize = ({ persist = false } = {}) => {
      if (!_sideBarResizeState) return;
      _sideBarResizeState = null;
      document.body.classList.remove("side-bar-resizing");
      if (persist) persistSideBarWidthAtDefaultTextSize();
    };
    const handleSideBarResizeMove = (event) => {
      if (!_sideBarResizeState || !sideBarOpen) return;
      const direction = document.documentElement.dataset.sideBarPosition === "left" ? -1 : 1;
      const nextWidth = _sideBarResizeState.startWidth + direction * (_sideBarResizeState.startX - event.clientX);
      sideBarWidthAtDefaultTextSize = clampSideBarWidthAtDefaultTextSize(unscaleSideBarWidth(nextWidth));
      applySideBarWidth();
      syncPanelState();
    };
    splitDivider?.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      _splitDragging = true;
      splitDivider.setPointerCapture(e.pointerId);
      document.body.classList.add("split-resizing");
    });
    splitDivider?.addEventListener("pointermove", (e) => {
      if (!_splitDragging || !gitContent || !splitPanel) return;
      const rect = splitPanel.getBoundingClientRect();
      let newH = document.documentElement.dataset.gitRepoPosition === "repo-top"
        ? rect.bottom - e.clientY
        : e.clientY - rect.top;
      setSplitGitHeight(Math.max(0, Math.min(rect.height, newH)));
    });
    splitDivider?.addEventListener("pointerup", () => {
      _splitDragging = false;
      document.body.classList.remove("split-resizing");
    });
    splitDivider?.addEventListener("pointercancel", () => {
      _splitDragging = false;
      document.body.classList.remove("split-resizing");
    });
    const swapGitRepoPosition = () => {
      if (document.documentElement.dataset.gitRepoPosition === "repo-top") {
        delete document.documentElement.dataset.gitRepoPosition;
        localStorage.removeItem(GIT_REPO_POSITION_KEY);
      } else {
        document.documentElement.dataset.gitRepoPosition = "repo-top";
        localStorage.setItem(GIT_REPO_POSITION_KEY, "repo-top");
      }
    };
    document.getElementById("gitRepoSwapBtn")?.addEventListener("pointerdown", (event) => event.stopPropagation());
    document.getElementById("gitRepoSwapBtn")?.addEventListener("click", swapGitRepoPosition);
    sideBarResizer?.addEventListener("pointerdown", (event) => {
      if (!sideBarOpen) return;
      event.preventDefault();
      event.stopPropagation();
      _sideBarResizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: currentSideBarWidthPx(),
      };
      document.body.classList.add("side-bar-resizing");
      try {
        sideBarResizer.setPointerCapture(event.pointerId);
      } catch (_) {}
    });
    const swapSideBarPosition = () => {
      if (document.documentElement.dataset.sideBarPosition === "left") {
        delete document.documentElement.dataset.sideBarPosition;
        localStorage.removeItem(SIDE_BAR_POSITION_KEY);
      } else {
        document.documentElement.dataset.sideBarPosition = "left";
        localStorage.setItem(SIDE_BAR_POSITION_KEY, "left");
      }
      syncPanelState();
    };
    document.getElementById("sideBarSwapBtn")?.addEventListener("click", swapSideBarPosition);
    sideBarResizer?.addEventListener("pointermove", (event) => {
      if (!_sideBarResizeState || _sideBarResizeState.pointerId !== event.pointerId) return;
      handleSideBarResizeMove(event);
    });
    sideBarResizer?.addEventListener("pointerup", (event) => {
      if (!_sideBarResizeState || _sideBarResizeState.pointerId !== event.pointerId) return;
      stopSideBarResize({ persist: true });
    });
    sideBarResizer?.addEventListener("pointercancel", () => {
      stopSideBarResize({ persist: true });
    });
    const normalizePath = (value) => String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    let fileContextPaths = [];
    let fileContextTriggerPath = "";
    let workspaceRoot = "";
    const openFileContextMenu = (rawPathOrPaths, event, { openFile = false, triggerPath = "" } = {}) => {
      const paths = (Array.isArray(rawPathOrPaths) ? rawPathOrPaths : [rawPathOrPaths])
        .map(normalizeWorkspaceFilePath)
        .filter(Boolean);
      if (!paths.length) return;
      event.preventDefault();
      event.stopPropagation();
      fileContextPaths = paths;
      fileContextTriggerPath = normalizeWorkspaceFilePath(triggerPath) || paths[0];
      window.parent?.postMessage({
        type: "show-file-context-menu",
        payload: {
          x: Math.round(Number(event.clientX) || 0),
          y: Math.round(Number(event.clientY) || 0),
          openFile,
        },
      }, "*");
    };
    let commitContextHash = "";
    const openCommitContextMenu = (hash, event) => {
      event.preventDefault();
      event.stopPropagation();
      commitContextHash = hash;
      window.parent?.postMessage({
        type: "show-commit-context-menu",
        payload: { x: Math.round(Number(event.clientX) || 0), y: Math.round(Number(event.clientY) || 0) },
      }, "*");
    };
    const loadWorkspaceRoot = async () => {
      if (!workspaceRoot) {
        const response = await fetchWithTimeout("/timeline-state", {}, 4000);
        if (!response.ok) throw new Error("Failed to read workspace path.");
        const state = await response.json();
        workspaceRoot = String(state?.workspace || "").replace(/\/+$/, "");
        if (!workspaceRoot) throw new Error("Workspace path is unavailable.");
      }
      return workspaceRoot;
    };
    const copyFilePath = async (paths, absolute) => {
      if (absolute || paths.some((path) => String(path).startsWith("/"))) await loadWorkspaceRoot();
      const text = paths.map((p) => {
        const path = normalizeWorkspaceFilePath(p);
        if (absolute) return path.startsWith("/") ? path : `${workspaceRoot}/${path}`;
        return path.startsWith(`${workspaceRoot}/`) ? path.slice(workspaceRoot.length + 1) : path;
      }).map((path) => `\`${path}\``).join("\n");
      await doCopyText(text);
      setStatus(absolute ? "Copied absolute path" : "Copied relative path");
    };
    const copyFiles = async (paths) => {
      const normalized = paths.map(normalizeWorkspaceFilePath).filter(Boolean);
      const root = normalized.some((path) => !path.startsWith("/")) ? await loadWorkspaceRoot() : "";
      const absolutePaths = normalized.map((path) => {
        return path.startsWith("/") ? path : `${root}/${path}`;
      });
      window.parent?.postMessage({ type: "copy-files-to-clipboard", paths: absolutePaths }, "*");
    };
    const revealFileInFinder = async (path) => {
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
    const quickLookPaths = async (paths) => {
      try {
        const native = document.documentElement.dataset.nativeApp === "1" && window.parent !== window;
        const response = await fetchWithTimeout("/quick-look", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths, native }),
        }, 8000);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || "Quick Look failed");
        }
        if (native) window.parent.postMessage({ type: "open-quick-look", paths: data.paths }, "*");
      } catch (err) {
        setError("Quick Look failed", err);
      }
    };
    function handleDesktopCommitContextMenuAction(payload) {
      const action = String(payload?.action || "");
      if (!["copyCommitHash", "copyCommitMessage"].includes(action)) return false;
      const hash = commitContextHash;
      if (!hash) return true;
      void (async () => {
        const info = await gitCommitInfo(hash);
        await doCopyText(action === "copyCommitHash" ? info.hash : info.message);
        setStatus(action === "copyCommitHash" ? "Copied hash" : "Copied message");
      })().catch((err) => {
        setError("Commit action failed", err);
      });
      return true;
    }
    function handleDesktopFileContextMenuAction(payload) {
      const action = String(payload?.action || "");
      if (!["openFile", "quickLook", "revealFileInFinder", "copyFiles", "copyAbsoluteFilePath", "copyRelativeFilePath"].includes(action)) return false;
      const paths = fileContextPaths;
      if (!paths.length) return true;
      const operation = action === "openFile"
        ? openFile(fileContextTriggerPath || paths[0])
        : action === "quickLook"
          ? quickLookPaths(paths)
          : action === "revealFileInFinder"
            ? revealFileInFinder(fileContextTriggerPath || paths[0])
            : action === "copyFiles"
              ? copyFiles(paths)
              : copyFilePath(paths, action === "copyAbsoluteFilePath");
      void operation.catch((err) => {
        setError("File action failed", err);
      });
      return true;
    }
    const chevronIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
    const BACK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>';
    const rootIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="12 6 6 12 12 18"/><polyline points="19 6 13 12 19 18"/></svg>';
    const fetchRepoDir = async (rawPath) => {
      const path = normalizePath(rawPath);
      const res = await fetchWithTimeout(`/files-dir?path=${encodeURIComponent(path)}`, {}, 12000);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load directory");
      const payload = await res.json().catch(() => ({}));
      const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
      return rawEntries
        .filter((item) => item && typeof item.path === "string")
        .map((item) => {
          const entryPath = normalizePath(item.path);
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
    const buildRepoEntryItem = (entry) => {
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
        chevronEl.innerHTML = chevronIcon;
        btn.appendChild(chevronEl);
        btn.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          const path = entry.path;
          if (e.shiftKey) { repoSel.selectRangeTo(path); return; }
          if (e.metaKey) { repoSel.toggle(path); return; }
          void loadRepoDir(path);
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
          const resolved = resolveRowClick(repoSel, entry.path, e);
          if (!resolved) return;
          const fileSet = repoFilePathSet();
          const targets = resolved.targets.filter((p) => fileSet.has(p));
          if (!targets.length) return;
          if (resolved.quickLook) {
            await quickLookPaths(targets);
            return;
          }
          for (const p of targets) {
            await openFileSurface(p, fileExtForPath(p), btn, e);
          }
        });
      }
      btn.addEventListener("contextmenu", (e) => {
        void openFileContextMenu(resolveContextMenuTargets(repoSel, entry.path), e, { triggerPath: entry.path });
      });
      return btn;
    };
    const repoEntriesStructureSignature = (entries) =>
      (entries || []).map((entry) => `${entry.kind}:${entry.path}`).join("\n");
    const renderRepoPanel = (rawPath, entries, { loading = false, error = "", direction = "none" } = {}) => {
      if (!repoContent) return;
      const path = normalizePath(rawPath);
      const pathParts = path.split("/").filter(Boolean);
      const parentPath = pathParts.slice(0, -1).join("/");
      const pathBasename = pathParts[pathParts.length - 1] || "/";
      const isSamePath = path === repoBrowserPath;
      const previousScrollTop = isSamePath
        ? repoContent.querySelector(".repo-browser-scroll")?.scrollTop || 0
        : 0;
      const rowKey = (el) => el.title || "";
      const firstRects = direction === "none" && !loading && !error
        ? captureListRowRects(repoContent, ".repo-browser-item", rowKey)
        : null;
      repoBrowserPath = path;
      if (!isSamePath) repoSel.clear();
      repoContent.innerHTML = "";
      if (error) {
        const node = document.createElement("div");
        node.className = "empty-state error";
        node.textContent = error;
        repoContent.appendChild(node);
        return;
      }
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
        void loadRepoDir(parentPath);
      });
      pathRow.addEventListener("keydown", (e) => {
        if (!path || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault(); e.stopPropagation();
        void loadRepoDir(parentPath);
      });
      const backIcon = document.createElement("span");
      backIcon.className = "repo-path-back-icon-slot";
      backIcon.innerHTML = BACK_ICON_SVG;
      const pathText = document.createElement("span");
      pathText.className = "repo-path-label";
      pathText.textContent = pathBasename;
      pathRow.append(backIcon, pathText);
      if (path) {
        const rootBtn = document.createElement("span");
        rootBtn.className = "repo-path-root-btn";
        rootBtn.setAttribute("role", "button");
        rootBtn.title = "Root";
        rootBtn.innerHTML = rootIcon;
        rootBtn.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          void loadRepoDir("");
        });
        pathRow.append(rootBtn);
      }
      pathWrap.appendChild(pathRow);
      pathWrap.addEventListener("contextmenu", (e) => {
        void openFileContextMenu(path, e);
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
      } else {
        const dirs = (entries || []).filter(e => e.kind === "dir");
        const files = (entries || []).filter(e => e.kind !== "dir");
        if (!dirs.length && !files.length) {
          const node = document.createElement("div");
          node.className = "repo-browser-empty";
          node.textContent = "Empty directory";
          list.appendChild(node);
        } else {
          dirs.forEach(e => list.appendChild(buildRepoEntryItem(e)));
          files.forEach(e => list.appendChild(buildRepoEntryItem(e)));
        }
      }
      scroll.appendChild(list);
      stack.appendChild(scroll);
      repoContent.appendChild(stack);
      scroll.scrollTop = previousScrollTop;
      flipListRows(repoContent, ".repo-browser-item", rowKey, firstRects);
      repoSel.prune();
      repoSel.applyClasses();
      scroll.addEventListener("mousedown", (e) => {
        if (e.target === scroll || e.target === list) repoSel.clear();
      });
    };
    const loadRepoDir = async (rawPath, { animate = true } = {}) => {
      if (!sideBarOpen) return;
      const path = normalizePath(rawPath);
      const currentDepth = repoBrowserPath.split("/").filter(Boolean).length;
      const newDepth = path.split("/").filter(Boolean).length;
      const direction = !animate
        ? "none"
        : newDepth > currentDepth
          ? "forward"
          : newDepth < currentDepth
            ? "back"
            : "none";
      const loadSeq = ++repoLoadSeq;
      const repoLoadCancelled = () => loadSeq !== repoLoadSeq || !sideBarOpen;
      cancelDpRepoLoading();
      cancelDpRepoLoading = startDelayedLoading(
        () => renderRepoPanel(path, [], { loading: true, direction }),
        repoLoadCancelled,
      );
      try {
        const [entries] = await Promise.all([
          fetchRepoDir(path),
          ensureFileIconTheme(),
        ]);
        cancelDpRepoLoading();
        if (repoLoadCancelled()) return;
        renderRepoPanel(path, entries, { direction });
      } catch (err) {
        cancelDpRepoLoading();
        if (repoLoadCancelled()) return;
        renderRepoPanel(path, [], { error: err?.message || "Failed to load directory", direction });
      }
    };
    const refreshRepoDir = async (rawPath) => {
      if (!sideBarOpen || !repoContent?.querySelector(".repo-browser-stack")) return;
      const path = normalizePath(rawPath);
      try {
        const [entries] = await Promise.all([
          fetchRepoDir(path),
          ensureFileIconTheme(),
        ]);
        if (!sideBarOpen || activeSideBarView !== "repo" || normalizePath(repoBrowserPath) !== path) return;
        const currentEntries = Array.from(repoContent.querySelectorAll(".repo-browser-item")).map((item) => ({
          kind: item.classList.contains("repo-browser-dir") ? "dir" : "file",
          path: normalizePath(item.title || ""),
        }));
        if (repoEntriesStructureSignature(currentEntries) === repoEntriesStructureSignature(entries)) return;
        renderRepoPanel(path, entries, { direction: "none" });
      } catch (_) {}
    };
    window.addEventListener("message", (event) => {
      if (!event.data) return;
      if (event.data.type === "hub-theme-changed") {
        const timelineTheme = event.data.timelineTheme || event.data.theme;
        document.documentElement.dataset.theme = timelineTheme === "light" ? "light" : "dark";
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
          applySideBarWidth();
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
        const enteringFitMode = !!event.data.on && document.documentElement.dataset.autoWindowHeight !== "1";
        document.documentElement.dataset.autoWindowHeight = event.data.on ? "1" : "0";
        if (enteringFitMode && gitSummaryPinned) toggleGitSummaryPinned();
        if (sideBarOpen) syncSplitGitHeightForMode();
        if (isComposerOverlayOpen()) autoResizeTextarea();
        syncMainAfterHeight();
        syncPinnedSummaryStrip();
        if (event.data.on) {
          requestAnimationFrame(reportFitHeight);
        } else {
          _stickyToBottom = true;
          requestAnimationFrame(() => scrollConversationToBottom("auto"));
          if (gitSummaryPinned) void refreshGitOverview();
        }
        return;
      }
      if (event.data.type === "side-bar-sync-request") {
        syncPanelState();
        return;
      }
      if (event.data.type === "file-context-menu-error") {
        setError("File menu failed", event.data.message);
        return;
      }
      if (event.data.type === "link-context-menu-error") {
        setError("Link menu failed");
        return;
      }
      if (event.data.type === "file-copy-result") {
        event.data.error ? setError("Copy failed", event.data.error) : setStatus("Copied file");
        return;
      }
      if (event.data.type === "quick-look-error") {
        setError("Quick Look failed", event.data.message);
        return;
      }
      if (event.data.type === "toggle-git-pin") {
        toggleGitSummaryPinned();
        return;
      }
      if (event.data.type === "desktop-timeline-reset") {
        closeSideBar();
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
      if (event.data.type === "hub-open-state") {
        if (event.data.open) document.documentElement.dataset.hubOpen = "1";
        else delete document.documentElement.dataset.hubOpen;
        return;
      }
      if (event.data.type !== "side-bar") return;
      const mode = String(event.data.mode || "");
      if (mode === "close") {
        closeSideBar();
      } else if (mode === "open") {
        toggleSideBar();
      } else if (mode === "git") {
        openSideBar({ view: "git", reset: true });
      } else if (mode === "repo") {
        openSideBar({ view: "repo" });
      } else if (mode === "swap") {
        swapSideBarPosition();
      } else if (mode === "swap-git-repo") {
        swapGitRepoPosition();
      } else {
        toggleSideBar();
      }
      window.focus();
    });
    (() => {
      window.addEventListener("keydown", (event) => {
        if (event.metaKey && event.ctrlKey && !event.altKey && !event.shiftKey && event.code === "KeyT") {
          event.preventDefault();
          window.parent?.postMessage({ type: "always-on-top-shortcut" }, "*");
          return;
        }
        if (event.metaKey && event.altKey) {
          if (event.code === "KeyB") {
            event.preventDefault();
            window.parent?.postMessage({ type: "toggle-hub-outward" }, "*");
            return;
          }
          if (event.code === "KeyE") {
            event.preventDefault();
            if (event.shiftKey) swapGitRepoPosition();
            else window.parent?.postMessage({ type: "toggle-side-bar-outward" }, "*");
            return;
          }
          if (event.code === "KeyT") {
            event.preventDefault();
            window.parent?.postMessage({ type: "desktop-menu-shortcut", action: "openShell" }, "*");
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
            const revealTarget = activeSideBarTargets(
              repoOrderedSelectedFiles, ".repo-browser-file:hover", ".git-commit-file-row:hover",
            ).slice(-1)[0] || "";
            if (revealTarget) {
              void revealFileInFinder(revealTarget).catch((err) => {
                setError("Reveal failed", err);
              });
            } else {
              window.parent?.postMessage({ type: "desktop-menu-shortcut", action: "openFinder" }, "*");
            }
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
          window.parent?.postMessage({ type: "desktop-menu-shortcut", action: "openTimelineHeaderMenu" }, "*");
          return;
        }
        if (event.metaKey && !event.altKey && event.code === "KeyB") {
          event.preventDefault();
          window.parent?.postMessage({ type: "toggle-hub" }, "*");
          return;
        }
        if (event.metaKey && event.shiftKey && !event.altKey && event.code === "KeyE") {
          event.preventDefault();
          swapSideBarPosition();
          return;
        }
        if (event.metaKey && !event.altKey && !event.shiftKey && event.code === "KeyE") {
          event.preventDefault();
          if (document.documentElement.dataset.autoWindowHeight === "1") {
            window.parent?.postMessage({ type: "toggle-side-bar" }, "*");
          } else {
            toggleSideBar();
          }
          return;
        }
        if (event.metaKey && !event.altKey && !event.shiftKey && !event.ctrlKey && event.code === "KeyT") {
          event.preventDefault();
          window.parent?.postMessage({ type: "desktop-menu-shortcut", action: "openPane" }, "*");
          return;
        }
        if (event.metaKey && !event.altKey && !event.ctrlKey && event.code === "KeyR") {
          event.preventDefault();
          window.parent?.postMessage({ type: "reload-shortcut", scope: event.shiftKey ? "hub" : "timeline" }, "*");
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
          toggleGitSummaryPinned();
          return;
        }
        if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && event.code === "KeyO") {
          const targets = activeSideBarTargets(
            repoOrderedSelectedFiles, ".repo-browser-file:hover", ".git-commit-file-row:hover",
          );
          if (targets.length) {
            event.preventDefault();
            for (const p of targets) void openFile(p);
          }
          return;
        }
        if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && event.code === "KeyY") {
          const targets = activeSideBarTargets(
            repoOrderedSelectedFiles, ".repo-browser-file:hover", ".git-commit-file-row:hover",
          );
          if (targets.length) {
            event.preventDefault();
            void quickLookPaths(targets);
          }
          return;
        }
        if (event.metaKey && event.altKey && !event.ctrlKey && event.code === "KeyC") {
          const targets = activeSideBarTargets(
            repoOrderedSelectedEntries, ".repo-browser-item:hover", ".git-commit-file-row:hover",
          );
          if (targets.length) {
            event.preventDefault();
            void copyFilePath(targets, !event.shiftKey).catch((err) => {
              setError("Copy failed", err);
            });
          }
          return;
        }
        if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && event.code === "KeyC") {
          const target = event.target;
          if (target instanceof Element && (target.closest("input, textarea") || target.isContentEditable)) return;
          if (window.getSelection()?.toString()) return;
          if (document.documentElement.dataset.nativeApp !== "1") return;
          const targets = activeSideBarTargets(
            repoOrderedSelectedEntries, ".repo-browser-item:hover", ".git-commit-file-row:hover",
          );
          if (targets.length) {
            event.preventDefault();
            void copyFiles(targets).catch((err) => {
              setError("Copy failed", err);
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
      if (sideBarOpen && activeSideBarView === "repo") {
        void refreshRepoDir(repoBrowserPath || "");
      }
    };
    const handleWorkspaceGitChanged = () => {
      gitPanel.invalidateFingerprint();
      if (!sideBarOpen && !gitSummaryPinned) {
        void notifyUnpinnedGitSummary();
        return;
      }
      if (sideBarOpen && !gitPanel.hasShell()) {
        void loadGitPage({ reset: true });
      } else {
        void refreshGitOverview();
      }
    };
    const postGitTreeLabel = async () => {
      if (window.parent === window) return;
      const worktrees = await fetchGitWorktrees().catch(() => []);
      const label = worktrees.find((item) => item.path === gitTree())?.branch || "";
      window.parent.postMessage({ type: "git-tree-label", label, follow: gitFollow() }, "*");
    };
    void postGitTreeLabel();
    document.addEventListener("git-follow-changed", () => void postGitTreeLabel());
    document.addEventListener("git-tree-changed", () => {
      void postGitTreeLabel();
      gitPanel.invalidateFingerprint();
      if (sideBarOpen) void loadGitPage({ reset: true });
      else if (gitSummaryPinned) void bootstrapPinnedGitSummary();
    });
    __INCLUDE:../events.js__
    onTimelineSummaryPinReload({ force: true });
    applySideBarWidth();
    refresh({ forceScroll: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        void refresh();
      }
    });
