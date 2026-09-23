    let paneViewerInterval = null;
    let paneViewerTabScrollRaf = 0;
    let paneViewerTabScrollEndTimer = null;
    let paneViewerOpenRaf = 0;
    let paneViewerInitialFetchTimer = 0;
    let lastPaneViewerTabIdx = 0;
    const mobileSheet = document.getElementById("mobileSheet");
    const paneTracePanel = document.getElementById("paneTracePanel");
    const nativeHeaderMenuSelect = document.getElementById("pageNativeMenuSelect");
    const useNativeHeaderMenuPicker = !!(nativeHeaderMenuSelect && rightMenuBtn);
    const clearNativeHeaderMenuSelection = () => {
      if (!nativeHeaderMenuSelect) return;
      nativeHeaderMenuSelect.value = "";
    };
    const syncNativeHeaderMenuSelectAnchor = () => {
      if (!useNativeHeaderMenuPicker || !nativeHeaderMenuSelect || !rightMenuBtn) return;
      const rect = rightMenuBtn.getBoundingClientRect();
      nativeHeaderMenuSelect.style.left = `${Math.round(rect.left)}px`;
      nativeHeaderMenuSelect.style.top = `${Math.round(rect.top)}px`;
      nativeHeaderMenuSelect.style.width = `${Math.max(1, Math.round(rect.width))}px`;
      nativeHeaderMenuSelect.style.height = `${Math.max(1, Math.round(rect.height))}px`;
    };
    const openNativeHeaderMenuPicker = () => {
      if (!useNativeHeaderMenuPicker || !nativeHeaderMenuSelect) return false;
      syncNativeHeaderMenuSelectAnchor();
      clearNativeHeaderMenuSelection();
      openNativeSelect(nativeHeaderMenuSelect);
      return true;
    };
    if (useNativeHeaderMenuPicker) {
      nativeHeaderMenuSelect.classList.add("is-ios-active");
      syncNativeHeaderMenuSelectAnchor();
    }
    nativeHeaderMenuSelect?.addEventListener("pointerdown", (event) => {
      if (agentActionSelectIsArmed()) {
        event.preventDefault();
        event.stopPropagation();
        showArmedAgentActionPicker();
        return;
      }
      resetAgentActionNativeMenu({ clearOptions: true });
    });
    nativeHeaderMenuSelect?.addEventListener("change", () => {
      const target = String(nativeHeaderMenuSelect.value || "");
      clearNativeHeaderMenuSelection();
      if (!target) return;
      _ignoreGlobalClick = true;
      void runForwardAction(target);
    });
    nativeHeaderMenuSelect?.addEventListener("blur", () => {
      setTimeout(clearNativeHeaderMenuSelection, 0);
    });
    const headerRoot = document.querySelector(".page-header");
    const hasOpenHeaderMenu = () => !!(mobileSheet?.classList.contains("open") || paneTracePanel?.classList.contains("open"));
    const mobileSheetCloseIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    const mobileSheetBackIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>';
    const showBottomSheet = (panel, onOpened = () => { }) => {
      if (!panel) return;
      const sheetPanel = panel.querySelector(".mobile-bottom-sheet-panel");
      if (sheetPanel) {
        sheetPanel.style.transition = "";
        if (sheetPanel._sheetSlideEnd) {
          sheetPanel.removeEventListener("transitionend", sheetPanel._sheetSlideEnd);
          sheetPanel._sheetSlideEnd = null;
        }
      }
      panel.hidden = false;
      panel.classList.remove("open", "sheet-closing");
      panel.classList.add("sheet-sliding");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          panel.classList.add("open");
          if (sheetPanel) {
            const finishSlide = (event) => {
              if (event.target !== sheetPanel || event.propertyName !== "transform") return;
              sheetPanel.removeEventListener("transitionend", finishSlide);
              sheetPanel._sheetSlideEnd = null;
              panel.classList.remove("sheet-sliding");
            };
            sheetPanel._sheetSlideEnd = finishSlide;
            sheetPanel.addEventListener("transitionend", finishSlide);
          }
          onOpened();
        });
      });
    };
    const wireMobileSheetNavDrag = (sheetNav, activeSheetRef, onClose) => {
      let startY = 0;
      let dragY = 0;
      let dragging = false;
      sheetNav.addEventListener("touchstart", (event) => {
        const touch = event.touches?.[0];
        if (!touch) return;
        startY = touch.clientY;
        dragY = 0;
        dragging = true;
        if (activeSheetRef.panel) activeSheetRef.panel.style.transition = "none";
      }, { passive: true });
      sheetNav.addEventListener("touchmove", (event) => {
        if (!dragging) return;
        const touch = event.touches?.[0];
        if (!touch) return;
        dragY = Math.max(0, touch.clientY - startY);
        if (activeSheetRef.panel) activeSheetRef.panel.style.transform = `translateY(${dragY}px)`;
      }, { passive: true });
      const finishDrag = () => {
        if (!dragging) return;
        dragging = false;
        if (dragY > 80) {
          onClose();
          return;
        }
        if (activeSheetRef.panel) {
          activeSheetRef.panel.style.transition = "";
          activeSheetRef.panel.style.transform = "";
        }
      };
      sheetNav.addEventListener("touchend", finishDrag, { passive: true });
      sheetNav.addEventListener("touchcancel", finishDrag, { passive: true });
    };
    const MOBILE_SHEET_ACTIVE_CLASS = "mobile-sheet-active";
    const sharedSheetActiveRef = { panel: null };
    let sharedSheetOnClose = () => { };
    const sharedSheetNav = document.createElement("div");
    sharedSheetNav.className = "mobile-bottom-sheet-nav";
    sharedSheetNav.innerHTML = `
      <div class="mobile-bottom-sheet-pill"></div>
      <div class="mobile-bottom-sheet-nav-bar">
        <div class="mobile-bottom-sheet-title"></div>
      </div>`;
    const sharedSheetTitleEl = sharedSheetNav.querySelector(".mobile-bottom-sheet-title");
    const sharedSheetFooter = document.createElement("div");
    sharedSheetFooter.className = "mobile-bottom-sheet-footer";
    sharedSheetFooter.innerHTML = `
      <button type="button" class="mobile-bottom-sheet-leading mobile-bottom-sheet-button" hidden></button>
      <button type="button" class="mobile-bottom-sheet-close mobile-bottom-sheet-button" aria-label="Close">
        ${mobileSheetCloseIcon}
      </button>`;
    const sharedSheetLeadingBtn = sharedSheetFooter.querySelector(".mobile-bottom-sheet-leading");
    const sharedSheetCloseBtn = sharedSheetFooter.querySelector(".mobile-bottom-sheet-close");
    let sharedSheetLeadingOnClick = null;
    sharedSheetLeadingBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      sharedSheetLeadingOnClick?.(event);
    });
    sharedSheetCloseBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      sharedSheetOnClose();
    });
    wireMobileSheetNavDrag(sharedSheetNav, sharedSheetActiveRef, () => sharedSheetOnClose());
    const attachSharedSheetChrome = (sheetPanel, { title, closeLabel, onClose }) => {
      sharedSheetOnClose = onClose;
      sharedSheetActiveRef.panel = sheetPanel;
      sharedSheetTitleEl.textContent = title;
      sharedSheetCloseBtn.setAttribute("aria-label", closeLabel);
      sheetPanel.prepend(sharedSheetNav);
      sheetPanel.appendChild(sharedSheetFooter);
    };
    const setSharedSheetLeading = (onClick, ariaLabel, html) => {
      if (!onClick) {
        sharedSheetLeadingBtn.hidden = true;
        sharedSheetLeadingOnClick = null;
        return;
      }
      sharedSheetLeadingBtn.hidden = false;
      sharedSheetLeadingBtn.disabled = false;
      sharedSheetLeadingOnClick = onClick;
      if (html) sharedSheetLeadingBtn.innerHTML = html;
      if (ariaLabel) sharedSheetLeadingBtn.setAttribute("aria-label", ariaLabel);
    };
    const ensureMobileSheetDom = (panel, {
      kind,
      title,
      closeLabel,
      onClose,
      leading = null,
      afterBuild = null,
    }) => {
      if (!panel) return null;
      const activate = () => {
        const sheetPanel = panel.querySelector(".mobile-bottom-sheet-panel");
        if (!sheetPanel || sharedSheetNav.parentElement === sheetPanel) return;
        attachSharedSheetChrome(sheetPanel, { title, closeLabel, onClose });
        setSharedSheetLeading(leading?.onClick || null, leading?.ariaLabel, leading?.html);
      };
      const existingContent = panel.querySelector(`.${kind}-sheet-content`);
      if (existingContent) {
        activate();
        return existingContent;
      }
      const sheet = document.createElement("div");
      sheet.className = `${kind}-sheet mobile-bottom-sheet`;
      const sheetPanel = document.createElement("div");
      sheetPanel.className = `${kind}-sheet-panel mobile-bottom-sheet-panel`;
      const contentEl = document.createElement("div");
      contentEl.className = `${kind}-sheet-content mobile-bottom-sheet-content`;
      const existing = document.createDocumentFragment();
      while (panel.firstChild) existing.appendChild(panel.firstChild);
      if (existing.childNodes.length) contentEl.appendChild(existing);
      sheetPanel.appendChild(contentEl);
      sheet.appendChild(sheetPanel);
      afterBuild?.({ sheetPanel, contentEl });
      panel.appendChild(sheet);
      activate();
      return contentEl;
    };
    const createMobileSheetController = (panel, activeClass, { onOpened = () => { }, onClosed = () => { } } = {}) => {
      let scrollY = 0;
      let scrollLocked = false;
      const lockScroll = () => {
        if (scrollLocked) return;
        scrollLocked = true;
        scrollY = window.scrollY || document.documentElement.scrollTop || 0;
        document.documentElement.classList.add(activeClass);
        document.body.classList.add(activeClass);
        document.body.style.top = `-${scrollY}px`;
      };
      const unlockScroll = () => {
        if (!scrollLocked) return;
        scrollLocked = false;
        document.documentElement.classList.remove(activeClass);
        document.body.classList.remove(activeClass);
        document.body.style.top = "";
        try { window.scrollTo(0, scrollY || 0); } catch (_) { }
      };
      const close = ({ immediate = false } = {}) => {
        if (!panel || panel.hidden) return;
        const sheetPanel = panel.querySelector(".mobile-bottom-sheet-panel");
        const finish = () => {
          if (sheetPanel) {
            if (sheetPanel._sheetSlideEnd) {
              sheetPanel.removeEventListener("transitionend", sheetPanel._sheetSlideEnd);
              sheetPanel._sheetSlideEnd = null;
            }
            sheetPanel.style.transition = "";
            sheetPanel.style.transform = "";
          }
          panel.classList.remove("open", "sheet-sliding", "sheet-closing");
          panel.hidden = true;
          unlockScroll();
          onClosed();
          syncHeaderMenuFocus();
        };
        if (sheetPanel?._sheetSlideEnd) {
          sheetPanel.removeEventListener("transitionend", sheetPanel._sheetSlideEnd);
          sheetPanel._sheetSlideEnd = null;
        }
        if (immediate || !panel.classList.contains("open")) {
          if (sheetPanel) {
            sheetPanel.style.transition = "none";
            sheetPanel.style.transform = "";
          }
          finish();
          return;
        }
        panel.classList.add("sheet-closing");
        panel.classList.remove("open", "sheet-sliding");
        if (!sheetPanel) {
          finish();
          return;
        }
        const finishFade = (event) => {
          if (event.target !== sheetPanel || event.propertyName !== "opacity") return;
          finish();
        };
        sheetPanel._sheetSlideEnd = finishFade;
        sheetPanel.addEventListener("transitionend", finishFade);
      };
      const open = (afterOpen = () => { }) => {
        if (!panel) return;
        lockScroll();
        showBottomSheet(panel, () => {
          syncHeaderMenuFocus();
          onOpened();
          afterOpen();
        });
      };
      return { open, close, lockScroll, unlockScroll };
    };
    const workspaceSheet = createMobileSheetController(mobileSheet, MOBILE_SHEET_ACTIVE_CLASS, {
      onClosed: () => {
        clearSheetPreview({ restoreChrome: false });
        gitSession.closeDetail();
        _repoBrowserPath = "";
        repoScrollByPath.clear();
        repoPanelRenderSig = "";
        repoBrowserMountEl()?.replaceChildren();
        if (mobileSheet) delete mobileSheet.dataset.kind;
      },
    });
    const closeSheet = (options) => workspaceSheet.close(options);
    const paneTraceSheet = createMobileSheetController(paneTracePanel, MOBILE_SHEET_ACTIVE_CLASS);
    const ensurePaneTraceSheetDom = () => ensureMobileSheetDom(paneTracePanel, {
      kind: "pane-trace",
      title: "Pane Trace",
      closeLabel: "Close pane trace",
      onClose: () => exitPaneTraceMode(),
    });
    const closePaneTraceSheet = (options) => {
      if (!paneTracePanel) return;
      paneTraceSheet.close(options);
    };
    const openPaneTraceSheet = (onOpened = () => { }) => {
      if (!paneTracePanel) return;
      ensurePaneTraceSheetDom();
      paneTraceSheet.open(onOpened);
    };
    const sheetIsOpen = () => !!(mobileSheet && mobileSheet.classList.contains("open") && !mobileSheet.hidden);
    const sheetKind = () => String(mobileSheet?.dataset.kind || "");
    const gitHostEl = () => mobileSheet?.querySelector(".git-host");
    const setSheetKind = (kind) => {
      if (!mobileSheet) return;
      mobileSheet.dataset.kind = kind;
      sharedSheetOnClose = () => closeSheet();
      sharedSheetCloseBtn.setAttribute("aria-label", kind === "git" ? "Close git" : "Close repository");
    };
    const updateHeaderMenuViewportMetrics = () => {
      if (!headerRoot) return;
      const rect = headerRoot.getBoundingClientRect();
      const height = Math.max(0, Math.round(rect.top));
      const left = Math.max(0, Math.round(rect.left));
      const width = Math.max(0, Math.round(rect.width));
      document.documentElement.style.setProperty("--header-menu-height", `${height}px`);
      document.documentElement.style.setProperty("--header-menu-left", `${left}px`);
      document.documentElement.style.setProperty("--header-menu-width", `${width}px`);
    };
    const syncHeaderMenuFocus = () => {
      if (hasOpenHeaderMenu()) updateHeaderMenuViewportMetrics();
    };
    const clearPaneViewerOpenWork = () => {
      if (paneViewerOpenRaf) {
        cancelAnimationFrame(paneViewerOpenRaf);
        paneViewerOpenRaf = 0;
      }
      if (paneViewerInitialFetchTimer) {
        clearTimeout(paneViewerInitialFetchTimer);
        paneViewerInitialFetchTimer = 0;
      }
    };
    function exitPaneTraceMode() {
      const paneEl = document.getElementById("paneViewer");
      clearPaneViewerOpenWork();
      if (paneViewerTabScrollEndTimer) {
        clearTimeout(paneViewerTabScrollEndTimer);
        paneViewerTabScrollEndTimer = null;
      }
      if (paneEl?.classList?.contains("visible") && paneViewerCarousel && paneViewerAgents.length) {
        const w = paneViewerCarousel.offsetWidth;
        if (w) {
          const idx = Math.max(0, Math.min(paneViewerAgents.length - 1, Math.round(paneViewerCarousel.scrollLeft / w)));
          paneViewerLastAgent = paneViewerAgents[idx];
        }
      }
      if (paneEl) {
        paneEl.classList.remove("visible");
        paneEl.hidden = true;
      }
      closePaneTraceSheet();
      if (paneViewerInterval) {
        clearInterval(paneViewerInterval);
        paneViewerInterval = null;
      }
      syncHeaderMenuFocus();
    }
    let repoSession = "";
    let repoPanelRenderSig = "";
    let repoPanelUpdateSeq = 0;
    let repoPanelEntries = [];
    let _repoBrowserPath = "";
    let cancelRepoLoading = () => {};
    const repoScrollByPath = new Map();
    let _repoGoToParentPath = () => { };
    const normalizeRepoPath = (value) => {
      const normalized = String(value || "").replace(/\\/g, "/");
      if (normalized.startsWith("/") || normalized.startsWith("~")) {
        return normalized.replace(/\/+$/g, "");
      }
      return normalized.replace(/^\/+|\/+$/g, "");
    };
    const repoParentPathForFile = (rawPath) => {
      const normalized = normalizeRepoPath(rawPath);
      const isAbsolute = normalized.startsWith("/");
      const parts = normalized.split("/").filter(Boolean);
      parts.pop();
      const joined = parts.join("/");
      return isAbsolute ? `/${joined}` : joined;
    };
    const repoSheetTitleEl = () => sharedSheetTitleEl;
    const repoSheetBackBtn = () => sharedSheetLeadingBtn;
    const repoBrowserMountEl = () => mobileSheet?.querySelector(".repo-browser-mount");
    const repoBrowserTitleForPath = (rawPath) => {
      const path = normalizeRepoPath(rawPath);
      return path ? (path.split("/").filter(Boolean).pop() || "Repository") : "Repository";
    };
    const setRepoSheetTitle = (text) => {
      const titleEl = repoSheetTitleEl();
      if (!titleEl) return;
      titleEl.textContent = text;
      titleEl.title = text;
    };
    const syncRepoSheetBackBtn = () => {
      const backBtn = repoSheetBackBtn();
      if (!backBtn) return;
      if (sheetPreviewOpen()) {
        backBtn.disabled = false;
        backBtn.setAttribute("aria-label", "Back to directory");
        return;
      }
      const atRoot = !normalizeRepoPath(_repoBrowserPath);
      backBtn.disabled = atRoot;
      backBtn.setAttribute("aria-label", atRoot ? "No parent directory" : "Go to parent directory");
    };
    const handleRepoSheetBack = () => {
      if (!mobileSheet) return;
      if (sheetPreviewOpen()) {
        popSheetPreview();
        return;
      }
      _repoGoToParentPath();
    };
    const restoreRepoChromeAfterPreview = () => {
      setRepoSheetTitle(repoBrowserTitleForPath(_repoBrowserPath));
      setSharedSheetLeading(handleRepoSheetBack, "Go to parent directory", mobileSheetBackIcon);
      syncRepoSheetBackBtn();
    };
    let _sheetPreviewStack = [];
    const applyPreviewChrome = (path) => {
      const filename = (displayAttachmentFilename(path) || path || "Preview").trim();
      sharedSheetTitleEl.replaceChildren(fileIconElement(path, {}, "sheet-title-file-icon"), filename);
      sharedSheetTitleEl.title = filename;
      sharedSheetTitleEl.classList.remove("git-sheet-detail-title", "git-sheet-title");
      setSharedSheetLeading(() => popSheetPreview(), "Back", mobileSheetBackIcon);
    };
    const clearSheetPreview = ({ restoreChrome = true } = {}) => {
      if (restoreChrome) _sheetPreviewStack = [];
      if (mobileSheet) {
        delete mobileSheet._previewPath;
        delete mobileSheet._previewExt;
        mobileSheet.classList.remove("sheet-mode-preview");
      }
      resetEmbeddedFilePreviewFrame(sheetPreviewFrameEl());
      resetRepoPreviewControls();
      if (!restoreChrome) return;
      if (sheetKind() === "git") restoreGitChromeAfterPreview();
      else restoreRepoChromeAfterPreview();
    };
    const closeSheetPreview = () => {
      if (!sheetPreviewOpen()) return;
      clearSheetPreview();
    };
    const popSheetPreview = () => {
      if (!sheetPreviewOpen()) return;
      const prev = _sheetPreviewStack.pop();
      if (!prev?.path) {
        closeSheetPreview();
        return;
      }
      void openSheetPreview(prev.path, prev.ext, { kind: prev.kind, pushHistory: false });
    };
    const wireMobileSheetSwipeBack = (surface, canGoBack, goBack, { ignore = "" } = {}) => {
      if (!surface) return;
      let startX = 0;
      let startY = 0;
      let tracking = false;
      let ready = false;
      const reset = () => {
        tracking = false;
        ready = false;
      };
      surface.addEventListener("touchstart", (event) => {
        if (!canGoBack()) return;
        if (ignore && event.target.closest?.(ignore)) return;
        const touch = event.touches?.[0];
        if (!touch) return;
        startX = touch.clientX;
        startY = touch.clientY;
        tracking = true;
        ready = false;
      }, { passive: true });
      surface.addEventListener("touchmove", (event) => {
        if (!tracking) return;
        const touch = event.touches?.[0];
        if (!touch) {
          reset();
          return;
        }
        const deltaX = touch.clientX - startX;
        const deltaY = touch.clientY - startY;
        if (Math.abs(deltaY) > 42) {
          reset();
          return;
        }
        if (deltaX > 56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) ready = true;
      }, { passive: true });
      surface.addEventListener("touchend", () => {
        if (!tracking) return;
        const shouldGoBack = ready;
        reset();
        if (shouldGoBack) goBack();
      }, { passive: true });
      surface.addEventListener("touchcancel", reset, { passive: true });
    };
    const ensureSheetDom = () => {
      if (!mobileSheet) return false;
      const existing = mobileSheet.querySelector(".mobile-bottom-sheet-content");
      if (existing) {
        const sheetPanel = mobileSheet.querySelector(".mobile-bottom-sheet-panel");
        if (sheetPanel && sharedSheetNav.parentElement !== sheetPanel) {
          sheetPanel.prepend(sharedSheetNav);
          sheetPanel.appendChild(sharedSheetFooter);
          sharedSheetActiveRef.panel = sheetPanel;
          sharedSheetOnClose = () => closeSheet();
        }
        return true;
      }
      ensureMobileSheetDom(mobileSheet, {
        kind: "workspace",
        title: "",
        closeLabel: "Close",
        onClose: () => closeSheet(),
        afterBuild: ({ contentEl }) => {
          const gitHost = document.createElement("div");
          gitHost.className = "git-host mobile-sheet-stack";
          const repoStack = document.createElement("div");
          repoStack.className = "repo-stack mobile-sheet-stack";
          const browserView = document.createElement("div");
          browserView.className = "repo-browser-view mobile-sheet-view mobile-sheet-list-view";
          const browserMount = document.createElement("div");
          browserMount.className = "repo-browser-mount";
          browserView.appendChild(browserMount);
          repoStack.appendChild(browserView);
          const previewView = document.createElement("div");
          previewView.className = "sheet-preview-view mobile-sheet-view";
          const previewFrame = document.createElement("iframe");
          previewFrame.className = "sheet-preview-frame";
          previewFrame.title = "File preview";
          previewView.appendChild(previewFrame);
          contentEl.append(gitHost, repoStack, previewView);
          wireMobileSheetSwipeBack(
            contentEl,
            () => sheetPreviewOpen()
              || (sheetKind() === "git" && !!gitSession.detailContext)
              || (sheetKind() === "repo" && !!normalizeRepoPath(_repoBrowserPath)),
            () => {
              if (sheetPreviewOpen()) popSheetPreview();
              else if (sheetKind() === "git") gitSession.closeDetail({ refreshList: gitSession.detailNeedsRefresh });
              else _repoGoToParentPath();
            },
          );
        },
      });
      wireRepoPreviewControls(sharedSheetFooter);
      return true;
    };
    const openSheetPreview = async (rawPath, ext, { kind, pushHistory = true } = {}) => {
      const targetKind = kind || sheetKind() || "repo";
      const path = targetKind === "repo"
        ? normalizeRepoPath(rawPath)
        : String(rawPath || "").trim();
      const normalizedExt = String(ext || fileExtForPath(path) || "").toLowerCase();
      if (!path || !mobileSheet) return;
      const [exists] = await Promise.all([fileExistsOnDisk(path), ensureFileIconTheme()]);
      if (!exists) {
        setStatus(`file not found: ${displayAttachmentFilename(path) || path}`, true);
        return;
      }
      ensureSheetDom();
      closePaneTraceSheet({ immediate: true });
      setSheetKind(targetKind);
      if (!sheetIsOpen()) workspaceSheet.open();
      if (sheetPreviewOpen()) {
        if (
          pushHistory
          && mobileSheet._previewPath
          && mobileSheet._previewPath !== path
        ) {
          _sheetPreviewStack.push({
            path: mobileSheet._previewPath,
            ext: mobileSheet._previewExt || fileExtForPath(mobileSheet._previewPath),
            kind: sheetKind() || targetKind,
          });
        }
        clearSheetPreview({ restoreChrome: false });
      } else {
        _sheetPreviewStack = [];
      }
      const frame = sheetPreviewFrameEl();
      if (!frame) return;
      mobileSheet._previewPath = path;
      mobileSheet._previewExt = normalizedExt;
      mobileSheet.classList.add("sheet-mode-preview");
      applyPreviewChrome(path);
      initRepoPreviewControls();
      wireEmbeddedFilePreviewFrame(frame, path, normalizedExt);
      if (targetKind !== "repo") return;
      const parentPath = repoParentPathForFile(path);
      if (typeof mobileSheet._openRepoPath === "function") {
        if (_repoBrowserPath !== parentPath || !repoBrowserMountEl()?.childElementCount) {
          await mobileSheet._openRepoPath(parentPath);
        }
      } else {
        _repoBrowserPath = parentPath;
      }
    };
    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "agent-preview-open-file") return;
      const path = String(event.data.path || "").trim();
      if (!path) return;
      void openSheetPreview(path, extFromPath(path), {
        kind: sheetKind() || "repo",
      });
    });
    const sheetListTopPlayPx = () => {
      const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-sheet-list-top-play"));
      return Number.isFinite(n) ? n : 0;
    };
    const pinSheetListBody = (el) => {
      const body = el?.querySelector(":scope > .mobile-sheet-list-body");
      if (!body || !el.clientHeight) return;
      const style = getComputedStyle(el);
      const padT = parseFloat(style.paddingTop) || 0;
      const padB = parseFloat(style.paddingBottom) || 0;
      body.style.minHeight = `${Math.max(0, el.clientHeight - padT - padB)}px`;
    };
    const resetSheetListScroll = (el) => {
      if (!el) return;
      const play = sheetListTopPlayPx();
      const pin = () => {
        pinSheetListBody(el);
        el.scrollTop = play;
      };
      pin();
      requestAnimationFrame(pin);
    };
    const restoreSheetListScroll = (el, top) => {
      if (!el) return;
      const pin = () => {
        pinSheetListBody(el);
        el.scrollTop = top;
      };
      pin();
      requestAnimationFrame(pin);
    };
    const mobileSheetStatusClassName = ({ error = false, loading = false } = {}) => {
      const parts = ["sheet-list-empty"];
      if (error) parts.push("error");
      if (loading) parts.push("inline-loading-row");
      return parts.join(" ");
    };
    const mobileSheetStatusInnerHtml = (text, { error = false, loading = false } = {}) => {
      const content = loading ? loadingIndicatorHtml() : escapeHtml(String(text ?? ""));
      return `<div class="${mobileSheetStatusClassName({ error, loading })}">${content}</div>`;
    };
    const mobileSheetStatusListHtml = (text, opts = {}) =>
      `<div class="mobile-sheet-view mobile-sheet-list is-sheet-status"><div class="mobile-sheet-list-body">${mobileSheetStatusInnerHtml(text, opts)}</div></div>`;
    const presentMobileSheetStatus = (mountEl, text, opts = {}) => {
      if (!mountEl) return null;
      mountEl.innerHTML = mobileSheetStatusListHtml(text, opts);
      const list = mountEl.querySelector(":scope > .mobile-sheet-list");
      if (!list) return null;
      const pin = () => {
        pinSheetListBody(list);
        list.scrollTop = 0;
      };
      pin();
      requestAnimationFrame(pin);
      return list;
    };
__CHAT_INCLUDE:../features/git-panel.js__
    const openGitSheet = async () => {
      if (!mobileSheet) return;
      ensureSheetDom();
      closePaneTraceSheet({ immediate: true });
      closeSheetPreview();
      setSheetKind("git");
      restoreGitChromeAfterPreview();
      if (!sheetIsOpen()) workspaceSheet.open();
      await updateGitPanel();
    };
    const openRepoSheet = () => {
      if (!mobileSheet) return;
      ensureSheetDom();
      closePaneTraceSheet({ immediate: true });
      closeSheetPreview();
      setSheetKind("repo");
      restoreRepoChromeAfterPreview();
      if (!sheetIsOpen()) workspaceSheet.open();
      if (typeof mobileSheet._syncCategoryUi === "function") {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => mobileSheet._syncCategoryUi());
        });
      }
    };
    const updateRepoPanel = async (entries) => {
      if (!mobileSheet) return;
      repoPanelEntries = Array.isArray(entries) ? entries : [];

      const normalizeRepoPath = (value) => String(value || "")
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "");
      const sessionKey = repoSession || currentSessionName || "";
      if (mobileSheet._repoSessionKey !== sessionKey) {
        mobileSheet._repoSessionKey = sessionKey;
        _repoBrowserPath = "";
        repoScrollByPath.clear();
        repoPanelRenderSig = "";
      }

      const fetchRepoDir = async (rawPath) => {
        const path = normalizeRepoPath(rawPath);
        const res = await fetchWithTimeout(`/files-dir?path=${encodeURIComponent(path)}`, {}, 12000);
        if (!res.ok) {
          throw new Error(res.status === 404 ? "Directory not found" : "Failed to load directory");
        }
        const payload = await res.json().catch(() => ({}));
        const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
        return rawEntries
          .filter((item) => item && typeof item.path === "string")
          .map((item) => {
            const entryPath = normalizeRepoPath(item.path);
            const entryName = String(item.name || entryPath.split("/").pop() || entryPath);
            const entryKind = item.kind === "dir" ? "dir" : "file";
            const rawSize = Number(item.size);
            return {
              name: entryName,
              path: entryPath,
              kind: entryKind,
              size: entryKind === "file" && Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : null,
            };
          })
          .sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
          });
      };

      const chevronRightIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';

      const renderPanel = (rawPath, entriesForPath, { loading = false, error = "", transition = "none" } = {}) => {
        const path = normalizeRepoPath(rawPath);
        const allEntries = Array.isArray(entriesForPath) ? entriesForPath : [];
        const nextRenderSig = JSON.stringify({
          session: sessionKey,
          path,
          loading: loading ? 1 : 0,
          error: String(error || ""),
          entries: allEntries.map((entry) => ({
            name: String(entry?.name || ""),
            path: String(entry?.path || ""),
            kind: entry?.kind === "dir" ? "dir" : "file",
            size: Number.isFinite(entry?.size) ? entry.size : null,
          })),
        });
        if (nextRenderSig === repoPanelRenderSig && repoBrowserMountEl()?.childElementCount) return;
        const prevList = repoBrowserMountEl()?.querySelector(".mobile-sheet-list");
        const isSamePath = path === _repoBrowserPath && !!prevList;
        const previousScrollTop = isSamePath ? prevList.scrollTop : 0;
        const rowKey = (el) => el.title || "";
        const firstRects = transition === "none" && isSamePath
          ? captureListRowRects(prevList, ".repo-browser-item", rowKey)
          : null;
        if (prevList && _repoBrowserPath !== path) repoScrollByPath.set(_repoBrowserPath, prevList.scrollTop);
        repoPanelRenderSig = nextRenderSig;
        _repoBrowserPath = path;
        ensureSheetDom();

        const goToParentPath = () => {
          if (!path) return;
          const parts = path.split("/").filter(Boolean);
          parts.pop();
          void openRepoPath(parts.join("/"), { transition: "back" });
        };
        _repoGoToParentPath = goToParentPath;
        const appendDirectoryItem = (container, dirEntry, selected = false) => {
          const btn = document.createElement("button");
          btn.type = "button";
          const isHidden = dirEntry.name.startsWith(".");
          btn.className = `repo-browser-item repo-browser-dir sheet-list-row${selected ? " selected" : ""}${isHidden ? " repo-browser-item-dimmed" : ""}`;
          btn.title = dirEntry.path;

          const icon = fileIconElement(dirEntry.path, { isDir: true }, "repo-browser-item-icon");

          const name = document.createElement("span");
          name.className = "repo-browser-item-name";
          name.textContent = dirEntry.name;

          const chevron = document.createElement("span");
          chevron.className = "repo-browser-item-chevron";
          chevron.setAttribute("aria-hidden", "true");
          chevron.innerHTML = chevronRightIcon;

          btn.append(icon, name, chevron);
          btn.addEventListener("mousedown", (event) => event.preventDefault());
          btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            void openRepoPath(dirEntry.path, { transition: "forward" });
          });
          container.appendChild(btn);
        };
        const appendFileItem = (container, fileEntry) => {
          const nameText = displayAttachmentFilename(fileEntry.path);
          const isHidden = nameText.startsWith(".");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `repo-browser-item repo-browser-file sheet-list-row${isHidden ? " repo-browser-item-dimmed" : ""}`;
          btn.title = fileEntry.path;

          const icon = fileIconElement(fileEntry.path, {}, "repo-browser-item-icon");

          const name = document.createElement("span");
          name.className = "repo-browser-item-name";
          name.textContent = nameText;

          btn.append(icon, name);

          const sizeLabel = formatFileSize(fileEntry.size);
          if (sizeLabel) {
            const size = document.createElement("span");
            size.className = "repo-browser-item-size";
            size.textContent = sizeLabel;
            btn.appendChild(size);
          }

          btn.addEventListener("mousedown", (event) => event.preventDefault());
          btn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await openSheetPreview(fileEntry.path, fileExtForPath(fileEntry.path), { kind: "repo" });
          });
          container.appendChild(btn);
        };
        const buildEntryGroups = (items) => {
          const listItems = Array.isArray(items) ? items : [];
          return {
            dirs: listItems.filter((entry) => entry?.kind === "dir"),
            files: listItems.filter((entry) => entry?.kind !== "dir"),
          };
        };
        const mount = repoBrowserMountEl();
        const { dirs: directoryEntries, files: fileEntries } = buildEntryGroups(allEntries);
        const finishChrome = () => {
          if (!sheetPreviewOpen()) {
            setRepoSheetTitle(repoBrowserTitleForPath(path));
            syncRepoSheetBackBtn();
          }
        };
        if (loading) {
          presentMobileSheetStatus(mount, "", { loading: true });
          finishChrome();
          return;
        }
        if (error) {
          presentMobileSheetStatus(mount, error, { error: true });
          finishChrome();
          return;
        }
        if (!directoryEntries.length && !fileEntries.length) {
          presentMobileSheetStatus(mount, "No files in this directory");
          finishChrome();
          return;
        }
        const list = document.createElement("div");
        list.className = "repo-browser-list mobile-sheet-list";
        if (transition === "forward" || transition === "back") {
          list.dataset.transition = transition;
        }
        const body = document.createElement("div");
        body.className = "mobile-sheet-list-body";
        directoryEntries.forEach((dirEntry) => appendDirectoryItem(body, dirEntry));
        fileEntries.forEach((fileEntry) => appendFileItem(body, fileEntry));
        list.appendChild(body);
        if (mount) mount.replaceChildren(list);
        if (transition === "back" && repoScrollByPath.has(path)) restoreSheetListScroll(list, repoScrollByPath.get(path));
        else if (transition === "none" && isSamePath) restoreSheetListScroll(list, previousScrollTop);
        else resetSheetListScroll(list);
        flipListRows(list, ".repo-browser-item", rowKey, firstRects);
        finishChrome();
      };

      const openRepoPath = async (rawPath, { transition = "none", preserveCurrent = false } = {}) => {
        const path = normalizeRepoPath(rawPath);
        if (mobileSheet._repoSessionKey !== sessionKey) return;
        const updateSeq = ++repoPanelUpdateSeq;
        const canPreserveCurrent = !!(
          preserveCurrent
          && path === _repoBrowserPath
          && repoBrowserMountEl()?.childElementCount
        );
        const repoLoadCancelled = () => updateSeq !== repoPanelUpdateSeq || mobileSheet._repoSessionKey !== sessionKey;
        cancelRepoLoading();
        if (!canPreserveCurrent) {
          cancelRepoLoading = startDelayedLoading(
            () => renderPanel(path, [], { loading: true, transition }),
            repoLoadCancelled,
          );
        }
        try {
          const [entriesForPath] = await Promise.all([
            fetchRepoDir(path),
            ensureFileIconTheme(),
          ]);
          cancelRepoLoading();
          if (repoLoadCancelled()) return;
          if (canPreserveCurrent && _repoBrowserPath !== path) return;
          renderPanel(path, entriesForPath, { transition });
        } catch (err) {
          cancelRepoLoading();
          if (repoLoadCancelled()) return;
          if (canPreserveCurrent) return;
          const errorText = String(err?.message || "Failed to load directory");
          if (path) {
            try {
              const [rootEntries] = await Promise.all([
                fetchRepoDir(""),
                ensureFileIconTheme(),
              ]);
              if (updateSeq !== repoPanelUpdateSeq || mobileSheet._repoSessionKey !== sessionKey) return;
              renderPanel("", rootEntries, { transition: "back" });
              return;
            } catch (_) { }
          }
          renderPanel(path, [], { error: errorText, transition });
        }
      };

      mobileSheet._syncCategoryUi = () => {
        if (sheetKind() !== "repo" || sheetPreviewOpen()) return;
        void openRepoPath(_repoBrowserPath, { transition: "none", preserveCurrent: true });
      };
      mobileSheet._openRepoPath = openRepoPath;
      mobileSheet._scrollToCategory = () => false;
      const panelVisible = sheetIsOpen() && sheetKind() === "repo";
      if (!panelVisible) return;
      if (sheetPreviewOpen()) return;
      await openRepoPath(_repoBrowserPath, { transition: "none", preserveCurrent: true });
    };
    const closeHeaderMenus = () => {
      resetAgentActionNativeMenu({ clearOptions: true });
      gitSession.closeDetail();
      exitPaneTraceMode();
      closeSheet();
      syncHeaderMenuFocus();
    };
    const handleNativeMenuAction = async (payload) => {
      const data = payload || {};
      if (data.action === "agent") {
        const mode = String(data.mode || "");
        const agent = String(data.agent || "");
        if ((mode === "add" || mode === "remove") && agent) {
          closeHeaderMenus();
          await performAgentAction(mode, agent);
        }
        return;
      }
      const action = String(data.action || "");
      if (!action) return;
      await runForwardAction(action);
    };
    window.addEventListener("message", (event) => {
      if (!(event.data && event.data.type === "native-menu-action")) return;
      void handleNativeMenuAction(event.data.payload);
    });
    window.addEventListener("native-menu-action", (event) => {
      void handleNativeMenuAction(event.detail || {});
    });
    rightMenuBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (agentActionSelectIsArmed()) {
        showArmedAgentActionPicker();
        return;
      }
      resetAgentActionNativeMenu({ clearOptions: true });
      if (useNativeHeaderMenuPicker) {
        if (openNativeHeaderMenuPicker()) return;
      }
      closeHeaderMenus();
    });
    mobileSheet?.addEventListener("click", (event) => {
      if (event.target !== mobileSheet) return;
      event.preventDefault();
      event.stopPropagation();
      closeSheet();
    });
    headerRoot?.addEventListener("click", (event) => {
      if (!sheetPreviewOpen()) return;
      if (event.defaultPrevented) return;
      if (event.target.closest(".page-menu-btn, .page-menu-panel, button, a, details, summary, input, textarea, select, label, [role='button']")) {
        return;
      }
      closeSheetPreview();
    });
    window.addEventListener("resize", () => {
      syncNativeHeaderMenuSelectAnchor();
      if (hasOpenHeaderMenu()) updateHeaderMenuViewportMetrics();
      if (sheetIsOpen() && sheetKind() === "repo" && typeof mobileSheet._syncCategoryUi === "function") {
        mobileSheet._syncCategoryUi();
      }
    });
    window.addEventListener("scroll", () => {
      syncNativeHeaderMenuSelectAnchor();
      if (hasOpenHeaderMenu()) updateHeaderMenuViewportMetrics();
    }, { passive: true });
    document.addEventListener("click", (event) => {
      if (_ignoreGlobalClick) {
        _ignoreGlobalClick = false;
        setTimeout(() => { skipAgentMenuBlur = false; }, 0);
        return;
      }

      const inRightMenu = rightMenuBtn?.contains(event.target);
      const inWorkspaceSheet = mobileSheet?.contains(event.target);
      const inPaneTraceMenu = paneTracePanel?.contains(event.target);
      const inNativeHeaderMenu = nativeHeaderMenuSelect?.contains(event.target);
      const agentActionNativeMenu = document.getElementById("agentActionNativeMenuSelect");
      const inAgentActionMenu = agentActionNativeMenu?.contains(event.target);
      if (!inRightMenu && !inWorkspaceSheet && !inPaneTraceMenu && !inNativeHeaderMenu && !inAgentActionMenu) {
        closeHeaderMenus();
      }
    });
    async function runForwardAction(target) {
      const action = String(target || "");
      if (!action) return;
      if (action === "esc" || action === "restart" || action === "ctrlc" || action === "enter") {
        await postShortcutCommand({ command_id: action, arg: "" });
        return;
      }
      if (action === "reloadChat") {
        await reloadChat();
        return;
      }
      if (action === "openGitMenu") {
        openGitSheet();
        return;
      }
      if (action === "openRepoMenu") {
        openRepoSheet();
        return;
      }
      if (action === "openPaneTraceWindow") {
        togglePaneViewer();
        return;
      }
      if (action === "addAgent") {
        showAddAgentModal();
        return;
      }
      if (action === "removeAgent") {
        showRemoveAgentModal();
        return;
      }
      throw new Error(`unknown menu action: ${action}`);
    }
