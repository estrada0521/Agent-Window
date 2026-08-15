    let paneViewerInterval = null;
    let paneViewerTabScrollRaf = 0;
    let paneViewerTabScrollEndTimer = null;
    let paneViewerOpenRaf = 0;
    let paneViewerInitialFetchTimer = 0;
    let lastPaneViewerTabIdx = 0;
    const gitBranchPanel = document.getElementById("gitBranchPanel");
    const attachedFilesPanel = document.getElementById("attachedFilesPanel");
    const paneTracePanel = document.getElementById("paneTracePanel");
    const nativeHeaderMenuSelect = document.getElementById("hubPageNativeMenuSelect");
    const isAppleTouchDevice = (() => {
      const ua = String(navigator.userAgent || "");
      if (/iP(hone|ad|od)/.test(ua)) return true;
      return navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1;
    })();
    const useNativeHeaderMenuPicker = !!(isAppleTouchDevice && nativeHeaderMenuSelect && rightMenuBtn);
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
      const show = () => {
        if (typeof nativeHeaderMenuSelect.showPicker === "function") {
          try { nativeHeaderMenuSelect.showPicker(); return true; } catch (_) { }
        }
        try { nativeHeaderMenuSelect.focus({ preventScroll: true }); } catch (_) {
          try { nativeHeaderMenuSelect.focus(); } catch (_) { }
        }
        try { nativeHeaderMenuSelect.click(); return true; } catch (_) { }
        return false;
      };
      const opened = show();
      if (!opened) setTimeout(() => { void show(); }, 0);
      return opened;
    };
    if (useNativeHeaderMenuPicker) {
      nativeHeaderMenuSelect.classList.add("is-ios-active");
      syncNativeHeaderMenuSelectAnchor();
    }
    nativeHeaderMenuSelect?.addEventListener("pointerdown", () => {
      resetAgentActionNativeMenu({ clearOptions: true });
    }, { passive: true });
    nativeHeaderMenuSelect?.addEventListener("change", () => {
      const target = String(nativeHeaderMenuSelect.value || "");
      clearNativeHeaderMenuSelection();
      if (!target) return;
      void runForwardAction(target, { sourceNode: null, keepComposerOpen: false, keepHeaderOpen: false });
    });
    nativeHeaderMenuSelect?.addEventListener("blur", () => {
      setTimeout(clearNativeHeaderMenuSelection, 0);
    });
    const headerRoot = document.querySelector(".hub-page-header");
    const hasOpenHeaderMenu = () => !!(gitBranchPanel?.classList.contains("open") || rightMenuPanel?.classList.contains("open") || attachedFilesPanel?.classList.contains("open") || paneTracePanel?.classList.contains("open"));
    const MOBILE_BOTTOM_SHEET_CLOSE_MS = 300;
    const mobileSheetCloseIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    const animateBottomSheetOpen = (panel, onOpened = () => { }) => {
      if (!panel) return;
      panel.hidden = false;
      panel.classList.remove("sheet-closing");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          panel.classList.add("open");
          onOpened();
        });
      });
    };
    const wireMobileSheetNavDrag = (sheetNav, sheetPanel, onClose) => {
      let startY = 0;
      let dragY = 0;
      let dragging = false;
      sheetNav.addEventListener("touchstart", (event) => {
        const touch = event.touches?.[0];
        if (!touch) return;
        startY = touch.clientY;
        dragY = 0;
        dragging = true;
        sheetPanel.style.transition = "none";
      }, { passive: true });
      sheetNav.addEventListener("touchmove", (event) => {
        if (!dragging) return;
        const touch = event.touches?.[0];
        if (!touch) return;
        dragY = Math.max(0, touch.clientY - startY);
        sheetPanel.style.transform = `translateY(${dragY}px)`;
      }, { passive: true });
      const finishDrag = () => {
        if (!dragging) return;
        dragging = false;
        sheetPanel.style.transition = "";
        sheetPanel.style.transform = "";
        if (dragY > 80) onClose();
      };
      sheetNav.addEventListener("touchend", finishDrag, { passive: true });
      sheetNav.addEventListener("touchcancel", finishDrag, { passive: true });
    };
    const buildMobileBottomSheet = ({
      kind,
      title = "",
      closeLabel = "Close",
      onClose = () => { },
      leadingButtonHtml = "",
    }) => {
      const sheet = document.createElement("div");
      sheet.className = `${kind}-sheet mobile-bottom-sheet mobile-floating-sheet`;
      const sheetPanel = document.createElement("div");
      sheetPanel.className = `${kind}-sheet-panel mobile-bottom-sheet-panel mobile-floating-sheet-panel`;
      const sheetNav = document.createElement("div");
      sheetNav.className = `${kind}-sheet-nav mobile-bottom-sheet-nav mobile-floating-sheet-nav`;
      const leading = leadingButtonHtml || "";
      sheetNav.innerHTML = `
        <div class="${kind}-sheet-pill mobile-bottom-sheet-pill mobile-floating-sheet-pill"></div>
        <div class="${kind}-sheet-nav-bar mobile-bottom-sheet-nav-bar mobile-floating-sheet-nav-bar">
          ${leading}
          <div class="${kind}-sheet-title mobile-bottom-sheet-title mobile-floating-sheet-title"></div>
          <button type="button" class="${kind}-sheet-close mobile-bottom-sheet-button mobile-floating-sheet-button" aria-label="${closeLabel}">
            ${mobileSheetCloseIcon}
          </button>
        </div>`;
      const titleEl = sheetNav.querySelector(`.${kind}-sheet-title`);
      if (titleEl) titleEl.textContent = title;
      const contentEl = document.createElement("div");
      contentEl.className = `${kind}-sheet-content mobile-bottom-sheet-content`;
      const closeBtn = sheetNav.querySelector(`.${kind}-sheet-close`);
      closeBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      });
      wireMobileSheetNavDrag(sheetNav, sheetPanel, onClose);
      sheetPanel.append(sheetNav, contentEl);
      sheet.appendChild(sheetPanel);
      return { sheet, sheetPanel, sheetNav, contentEl, titleEl, closeBtn };
    };
    const createMobileSheetController = (panel, activeClass, { onOpened = () => { }, onClosed = () => { } } = {}) => {
      let closeTimer = 0;
      let scrollY = 0;
      let scrollLocked = false;
      const clearCloseTimer = () => {
        if (!closeTimer) return;
        clearTimeout(closeTimer);
        closeTimer = 0;
      };
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
        if (!panel) return;
        clearCloseTimer();
        panel.classList.remove("open");
        if (immediate) {
          panel.classList.remove("sheet-closing");
          panel.hidden = true;
          unlockScroll();
          onClosed();
          syncHeaderMenuFocus();
          return;
        }
        panel.classList.add("sheet-closing");
        closeTimer = window.setTimeout(() => {
          closeTimer = 0;
          panel.classList.remove("sheet-closing");
          panel.hidden = true;
          unlockScroll();
          onClosed();
          syncHeaderMenuFocus();
        }, MOBILE_BOTTOM_SHEET_CLOSE_MS);
        syncHeaderMenuFocus();
      };
      const open = (afterOpen = () => { }) => {
        if (!panel) return;
        clearCloseTimer();
        lockScroll();
        animateBottomSheetOpen(panel, () => {
          syncHeaderMenuFocus();
          onOpened();
          afterOpen();
        });
      };
      return { open, close, clearCloseTimer, lockScroll, unlockScroll };
    };
    const attachedFilesSheet = createMobileSheetController(attachedFilesPanel, "attached-files-sheet-active", {
      onClosed: () => {
        _attachedFilesPreviewPath = "";
        _attachedFilesPreviewExt = "";
        attachedFilesPanel?.classList.remove("attached-files-mode-preview");
        resetEmbeddedFilePreviewFrame(attachedFilesPreviewFrameEl());
      },
    });
    const closeAttachedFilesSheet = (options) => attachedFilesSheet.close(options);
    const openAttachedFilesSheet = () => {
      if (!attachedFilesPanel) return;
      if (attachedFilesPanel.classList.contains("attached-files-mode-preview")) {
        closeAttachedFilesRepoPreview();
      }
      closeGitBranchSheet({ immediate: true });
      closePaneTraceSheet({ immediate: true });
      attachedFilesSheet.open();
      if (typeof attachedFilesPanel._syncCategoryUi === "function") {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => attachedFilesPanel._syncCategoryUi());
        });
      }
    };
    const paneTraceSheet = createMobileSheetController(paneTracePanel, "pane-trace-sheet-active");
    const paneTraceSheetContentEl = () => paneTracePanel?.querySelector(".pane-trace-sheet-content");
    const ensurePaneTraceSheetDom = () => {
      if (!paneTracePanel) return null;
      let contentEl = paneTraceSheetContentEl();
      if (contentEl) return contentEl;

      const existing = document.createDocumentFragment();
      while (paneTracePanel.firstChild) existing.appendChild(paneTracePanel.firstChild);

      const { sheet, contentEl: sheetContentEl } = buildMobileBottomSheet({
        kind: "pane-trace",
        title: "Pane Trace",
        closeLabel: "Close pane trace",
        onClose: () => exitPaneTraceMode(),
      });
      contentEl = sheetContentEl;
      contentEl.appendChild(existing);
      paneTracePanel.appendChild(sheet);
      return contentEl;
    };
    const closePaneTraceSheet = ({ immediate = false } = {}) => {
      if (!paneTracePanel) return;
      paneTraceSheet.close({ immediate });
    };
    const openPaneTraceSheet = (onOpened = () => { }) => {
      if (!paneTracePanel) return;
      ensurePaneTraceSheetDom();
      paneTraceSheet.open(onOpened);
    };
    const gitBranchSheet = createMobileSheetController(gitBranchPanel, "git-branch-sheet-active");
    const gitBranchSheetContentEl = () => gitBranchPanel?.querySelector(".git-branch-sheet-content");
    const ensureGitBranchSheetDom = () => {
      if (!gitBranchPanel) return null;
      let contentEl = gitBranchSheetContentEl();
      if (contentEl) return contentEl;

      const existing = document.createDocumentFragment();
      while (gitBranchPanel.firstChild) existing.appendChild(gitBranchPanel.firstChild);

      const { sheet, contentEl: sheetContentEl } = buildMobileBottomSheet({
        kind: "git-branch",
        title: "Git Branches",
        closeLabel: "Close git branches",
        onClose: () => closeGitBranchSheet(),
      });
      contentEl = sheetContentEl;
      contentEl.appendChild(existing);
      gitBranchPanel.appendChild(sheet);
      return contentEl;
    };
    const closeGitBranchSheet = ({ immediate = false } = {}) => {
      if (!gitBranchPanel) return;
      gitBranchSheet.close({ immediate });
    };
    const openGitBranchSheet = async () => {
      if (!gitBranchPanel) return;
      closeAttachedFilesSheet({ immediate: true });
      closePaneTraceSheet({ immediate: true });
      ensureGitBranchSheetDom();
      setGitBranchSheetTitle("Git Branches");
      gitBranchSheet.open();
      await updateGitBranchPanel();
    };
    const updateHeaderMenuViewportMetrics = () => {
      if (!headerRoot) return;
      const rect = headerRoot.getBoundingClientRect();
      const top = Math.max(0, Math.round(rect.bottom));
      const left = Math.max(0, Math.round(rect.left));
      const width = Math.max(0, Math.round(rect.width));
      document.documentElement.style.setProperty("--header-menu-top", `${top}px`);
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
    const isLocalHubHostname = (host = String(location.hostname || "")) =>
      host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host.startsWith("192.168.") || host.startsWith("10.") || /^172\\.(1[6-9]|2\\d|3[01])\\./.test(host);
    let attachedFilesSession = "";
    let attachedFilesPanelRenderSig = "";
    let attachedFilesPanelUpdateSeq = 0;
    let attachedFilesPanelEntries = [];
    let _attachedFilesBrowserPath = "";
    let _attachedFilesPreviewPath = "";
    let _attachedFilesPreviewExt = "";
    let _attachedFilesGoToParentPath = () => { };
    const attachedFilesSheetBackIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>';
    const normalizeAttachedFilesRepoPath = (value) => {
      const normalized = String(value || "").replace(/\\/g, "/");
      if (normalized.startsWith("/") || normalized.startsWith("~")) {
        return normalized.replace(/\/+$/g, "");
      }
      return normalized.replace(/^\/+|\/+$/g, "");
    };
    const attachedFilesParentPathForFile = (rawPath) => {
      const normalized = normalizeAttachedFilesRepoPath(rawPath);
      const isAbsolute = normalized.startsWith("/");
      const parts = normalized.split("/").filter(Boolean);
      parts.pop();
      const joined = parts.join("/");
      return isAbsolute ? `/${joined}` : joined;
    };
    const attachedFilesSheetTitleEl = () => attachedFilesPanel?.querySelector(".attached-files-sheet-title");
    const attachedFilesSheetBackBtn = () => attachedFilesPanel?.querySelector(".attached-files-sheet-back");
    const attachedFilesBrowserMountEl = () => attachedFilesPanel?.querySelector(".attached-files-browser-mount");
    const attachedFilesBrowserTitleForPath = (rawPath) => {
      const path = normalizeAttachedFilesRepoPath(rawPath);
      return path ? (path.split("/").filter(Boolean).pop() || "Repository") : "Repository";
    };
    const setAttachedFilesSheetTitle = (text) => {
      const titleEl = attachedFilesSheetTitleEl();
      if (!titleEl) return;
      titleEl.textContent = text;
      titleEl.title = text;
    };
    const syncAttachedFilesSheetBackBtn = () => {
      const backBtn = attachedFilesSheetBackBtn();
      if (!backBtn) return;
      const navBar = backBtn.closest(".attached-files-sheet-nav-bar");
      if (attachedFilesPanel?.classList.contains("attached-files-mode-preview")) {
        navBar?.classList.remove("attached-files-sheet-nav-at-root");
        backBtn.disabled = false;
        backBtn.setAttribute("aria-label", "Back to directory");
        return;
      }
      const atRoot = !normalizeAttachedFilesRepoPath(_attachedFilesBrowserPath);
      navBar?.classList.toggle("attached-files-sheet-nav-at-root", atRoot);
      backBtn.disabled = atRoot;
      backBtn.setAttribute("aria-label", atRoot ? "No parent directory" : "Go to parent directory");
    };
    const clearAttachedFilesRepoPreview = () => {
      _attachedFilesPreviewPath = "";
      _attachedFilesPreviewExt = "";
      if (attachedFilesPanel) {
        delete attachedFilesPanel._previewPath;
        delete attachedFilesPanel._previewExt;
      }
      attachedFilesPanel?.classList.remove("attached-files-mode-preview");
      resetEmbeddedFilePreviewFrame(attachedFilesPreviewFrameEl());
      resetAttachedFilesPreviewControls();
      setAttachedFilesSheetTitle(attachedFilesBrowserTitleForPath(_attachedFilesBrowserPath));
      syncAttachedFilesSheetBackBtn();
    };
    const closeAttachedFilesRepoPreview = () => {
      if (!_attachedFilesPreviewPath) return;
      clearAttachedFilesRepoPreview();
    };
    const handleAttachedFilesSheetBack = () => {
      if (!attachedFilesPanel) return;
      if (attachedFilesPanel.classList.contains("attached-files-mode-preview")) {
        closeAttachedFilesRepoPreview();
        return;
      }
      _attachedFilesGoToParentPath();
    };
    const ensureAttachedFilesSheetDom = () => {
      if (!attachedFilesPanel) return false;
      if (attachedFilesPanel.querySelector(".attached-files-sheet")) return true;

      const stack = document.createElement("div");
      stack.className = "attached-files-stack";

      const browserView = document.createElement("div");
      browserView.className = "attached-files-browser-view";
      const browserMount = document.createElement("div");
      browserMount.className = "attached-files-browser-mount";
      browserView.appendChild(browserMount);

      const previewView = document.createElement("div");
      previewView.className = "attached-files-preview-view";
      const previewFrame = document.createElement("iframe");
      previewFrame.className = "attached-files-preview-frame";
      previewFrame.title = "File preview";
      previewView.appendChild(previewFrame);
      stack.append(browserView, previewView);

      const { sheet, sheetNav, contentEl: sheetContentEl } = buildMobileBottomSheet({
        kind: "attached-files",
        title: "Repository",
        closeLabel: "Close attached files",
        onClose: () => closeAttachedFilesSheet(),
        leadingButtonHtml: `<button type="button" class="attached-files-sheet-back mobile-bottom-sheet-button mobile-floating-sheet-button" aria-label="Go to parent directory">${attachedFilesSheetBackIcon}</button>`,
      });
      sheetNav.querySelector(".attached-files-sheet-back")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleAttachedFilesSheetBack();
      });
      wireAttachedFilesPreviewControls(sheetNav);

      let swipeStartX = 0;
      let swipeStartY = 0;
      let swipeTracking = false;
      let swipeBackReady = false;
      const resetSwipeBack = () => {
        swipeTracking = false;
        swipeBackReady = false;
      };
      browserView.addEventListener("touchstart", (event) => {
        if (!normalizeAttachedFilesRepoPath(_attachedFilesBrowserPath)) return;
        const touch = event.touches?.[0];
        if (!touch) return;
        swipeStartX = touch.clientX;
        swipeStartY = touch.clientY;
        swipeTracking = true;
        swipeBackReady = false;
      }, { passive: true });
      browserView.addEventListener("touchmove", (event) => {
        if (!swipeTracking) return;
        const touch = event.touches?.[0];
        if (!touch) {
          resetSwipeBack();
          return;
        }
        const deltaX = touch.clientX - swipeStartX;
        const deltaY = touch.clientY - swipeStartY;
        if (Math.abs(deltaY) > 42) {
          resetSwipeBack();
          return;
        }
        if (deltaX > 56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
          swipeBackReady = true;
        }
      }, { passive: true });
      browserView.addEventListener("touchend", () => {
        if (!swipeTracking) return;
        const shouldBack = swipeBackReady;
        resetSwipeBack();
        if (shouldBack) _attachedFilesGoToParentPath();
      }, { passive: true });
      browserView.addEventListener("touchcancel", resetSwipeBack, { passive: true });

      sheetContentEl.appendChild(stack);
      attachedFilesPanel.appendChild(sheet);
      syncAttachedFilesSheetBackBtn();
      return true;
    };
    const openAttachedFilesPreview = async (rawPath, ext) => {
      const path = normalizeAttachedFilesRepoPath(rawPath);
      const normalizedExt = String(ext || fileExtForPath(path) || "").toLowerCase();
      if (!path || !attachedFilesPanel) return;
      if (!ensureAttachedFilesSheetDom()) return;
      if (!isPublicChatView) {
        const exists = await fileExistsOnDisk(path);
        if (!exists) {
          setStatus(`file not found: ${displayAttachmentFilename(path) || path}`, true);
          setTimeout(() => setStatus(""), 2200);
          return;
        }
      }
      const frame = attachedFilesPreviewFrameEl();
      if (!frame) return;
      const parentPath = attachedFilesParentPathForFile(path);
      const sheetOpen = attachedFilesPanel.classList.contains("open") && !attachedFilesPanel.hidden;
      if (!sheetOpen) attachedFilesSheet.open();
      if (attachedFilesPanel.classList.contains("attached-files-mode-preview")) {
        clearAttachedFilesRepoPreview();
      }
      if (typeof attachedFilesPanel._openRepoPath === "function") {
        if (_attachedFilesBrowserPath !== parentPath || !attachedFilesBrowserMountEl()?.childElementCount) {
          await attachedFilesPanel._openRepoPath(parentPath);
        }
      } else {
        _attachedFilesBrowserPath = parentPath;
      }
      _attachedFilesPreviewPath = path;
      _attachedFilesPreviewExt = normalizedExt;
      attachedFilesPanel._previewPath = path;
      attachedFilesPanel._previewExt = normalizedExt;
      attachedFilesPanel.classList.add("attached-files-mode-preview");
      const filename = (displayAttachmentFilename(path) || path || "Preview").trim();
      setAttachedFilesSheetTitle(filename);
      syncAttachedFilesSheetBackBtn();
      initAttachedFilesPreviewControls();
      wireEmbeddedFilePreviewFrame(frame, path, normalizedExt);
    };
    if (attachedFilesPanel) attachedFilesPanel._openFilePreview = openAttachedFilesPreview;
__CHAT_INCLUDE:../features/git-panel.js__
    const updateAttachedFilesPanel = async (entries) => {
      if (!attachedFilesPanel) return;
      attachedFilesPanelEntries = Array.isArray(entries) ? entries : [];
      document.querySelectorAll(".hub-page-menu-btn .attached-files-badge").forEach((node) => node.remove());

      const normalizeRepoPath = (value) => String(value || "")
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "");
      const sessionKey = attachedFilesSession || currentSessionName || "";
      if (attachedFilesPanel._repoSessionKey !== sessionKey) {
        attachedFilesPanel._repoSessionKey = sessionKey;
        _attachedFilesBrowserPath = "";
        attachedFilesPanelRenderSig = "";
      }

      const fetchRepoDir = async (rawPath) => {
        const path = normalizeRepoPath(rawPath);
        let res;
        try {
          res = await fetchWithTimeout(`/files-dir?path=${encodeURIComponent(path)}`, {}, 12000);
        } catch (err) {
          const isTimeout = /timeout/i.test(String(err?.message || ""));
          if (!isTimeout) throw err;
          res = await fetchWithTimeout(`/files-dir?path=${encodeURIComponent(path)}`, {}, 20000);
        }
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

      const folderIcon = wrapFileIcon('<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5.1a1.5 1.5 0 0 1 1.06.44l1.9 1.9a1.5 1.5 0 0 0 1.06.44H19.5A1.5 1.5 0 0 1 21 9.28V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');
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
        if (nextRenderSig === attachedFilesPanelRenderSig && attachedFilesBrowserMountEl()?.childElementCount) return;
        attachedFilesPanelRenderSig = nextRenderSig;
        _attachedFilesBrowserPath = path;
        if (_attachedFilesPreviewPath) clearAttachedFilesRepoPreview();
        ensureAttachedFilesSheetDom();

        const browser = document.createElement("div");
        browser.className = "repo-browser repo-browser-mobile";
        const goToParentPath = () => {
          if (!path) return;
          const parts = path.split("/").filter(Boolean);
          parts.pop();
          void openRepoPath(parts.join("/"), { transition: "back" });
        };
        _attachedFilesGoToParentPath = goToParentPath;
        const appendMessage = (container, text, className = "repo-browser-empty", { loading = false } = {}) => {
          const node = document.createElement("div");
          node.className = className;
          if (loading) {
            node.classList.add("inline-loading-row");
            node.innerHTML = loadingIndicatorHtml(text || "Loading…");
          } else {
            node.textContent = text;
          }
          container.appendChild(node);
        };
        const appendDirectoryItem = (container, dirEntry, selected = false) => {
          const btn = document.createElement("button");
          btn.type = "button";
          const isHidden = dirEntry.name.startsWith(".");
          btn.className = `repo-browser-item repo-browser-dir${selected ? " selected" : ""}${isHidden ? " repo-browser-item-dimmed" : ""}`;
          btn.title = dirEntry.path;

          const icon = document.createElement("span");
          icon.className = "repo-browser-item-icon";
          icon.setAttribute("aria-hidden", "true");
          icon.innerHTML = folderIcon;

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
          const ext = fileExtForPath(fileEntry.path);
          const nameText = displayAttachmentFilename(fileEntry.path);
          const isHidden = nameText.startsWith(".");
          const iconMarkup = FILE_ICONS[ext] || FILE_SVG_ICONS.file;
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `repo-browser-item repo-browser-file${isHidden ? " repo-browser-item-dimmed" : ""}`;
          btn.title = fileEntry.path;

          const icon = document.createElement("span");
          icon.className = "repo-browser-item-icon";
          icon.setAttribute("aria-hidden", "true");
          icon.innerHTML = iconMarkup;

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
            await openAttachedFilesPreview(fileEntry.path, ext);
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
        const list = document.createElement("div");
        list.className = "repo-browser-list";
        if (transition === "forward" || transition === "back") {
          list.dataset.transition = transition;
        }
        const { dirs: directoryEntries, files: fileEntries } = buildEntryGroups(allEntries);
        if (loading) {
          appendMessage(list, "Loading…", "repo-browser-empty", { loading: true });
        } else if (error) {
          appendMessage(list, error, "repo-browser-empty error");
        } else if (!directoryEntries.length && !fileEntries.length) {
          appendMessage(list, "No files in this directory");
        } else {
          directoryEntries.forEach((dirEntry) => appendDirectoryItem(list, dirEntry));
          fileEntries.forEach((fileEntry) => appendFileItem(list, fileEntry));
        }
        browser.appendChild(list);
        const mount = attachedFilesBrowserMountEl();
        if (mount) mount.replaceChildren(browser);
        setAttachedFilesSheetTitle(attachedFilesBrowserTitleForPath(path));
        syncAttachedFilesSheetBackBtn();
      };

      const openRepoPath = async (rawPath, { transition = "none", preserveCurrent = false } = {}) => {
        const path = normalizeRepoPath(rawPath);
        if (attachedFilesPanel._repoSessionKey !== sessionKey) return;
        const updateSeq = ++attachedFilesPanelUpdateSeq;
        const canPreserveCurrent = !!(
          preserveCurrent
          && path === _attachedFilesBrowserPath
          && attachedFilesBrowserMountEl()?.childElementCount
        );
        if (!canPreserveCurrent) renderPanel(path, [], { loading: true, transition });
        try {
          const entriesForPath = await fetchRepoDir(path);
          if (updateSeq !== attachedFilesPanelUpdateSeq || attachedFilesPanel._repoSessionKey !== sessionKey) return;
          if (canPreserveCurrent && _attachedFilesBrowserPath !== path) return;
          renderPanel(path, entriesForPath, { transition });
        } catch (err) {
          if (updateSeq !== attachedFilesPanelUpdateSeq || attachedFilesPanel._repoSessionKey !== sessionKey) return;
          if (canPreserveCurrent) return;
          const errorText = String(err?.message || "Failed to load directory");
          if (path) {
            try {
              const rootEntries = await fetchRepoDir("");
              if (updateSeq !== attachedFilesPanelUpdateSeq || attachedFilesPanel._repoSessionKey !== sessionKey) return;
              renderPanel("", rootEntries, { transition: "back" });
              return;
            } catch (_) { }
          }
          renderPanel(path, [], { error: errorText, transition });
        }
      };

      attachedFilesPanel._syncCategoryUi = () => {
        if (attachedFilesPanel.classList.contains("attached-files-mode-preview")) return;
        void openRepoPath(_attachedFilesBrowserPath, { transition: "none", preserveCurrent: true });
      };
      attachedFilesPanel._openRepoPath = openRepoPath;
      attachedFilesPanel._scrollToCategory = () => false;
      const panelVisible = attachedFilesPanel.classList.contains("open") && !attachedFilesPanel.hidden;
      if (!panelVisible) return;
      if (attachedFilesPanel.classList.contains("attached-files-mode-preview")) return;
      await openRepoPath(_attachedFilesBrowserPath, { transition: "none", preserveCurrent: true });
    };
    const closeHeaderMenus = () => {
      resetAgentActionNativeMenu({ clearOptions: true });
      closeGitBranchInlineDiff();
      exitPaneTraceMode();
      closeGitBranchSheet({ immediate: true });
      rightMenuPanel?.classList.remove("open");
      if (rightMenuPanel) rightMenuPanel.hidden = true;
      rightMenuBtn?.classList.remove("open");
      closeAttachedFilesSheet({ immediate: true });
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
      await runForwardAction(action, { sourceNode: null, keepComposerOpen: false, keepHeaderOpen: false });
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
      resetAgentActionNativeMenu({ clearOptions: true });
      if (useNativeHeaderMenuPicker) {
        if (openNativeHeaderMenuPicker()) return;
      }
      closeHeaderMenus();
    });
    attachedFilesPanel?.addEventListener("click", (event) => {
      if (event.target !== attachedFilesPanel) return;
      event.preventDefault();
      event.stopPropagation();
      closeAttachedFilesSheet();
    });
    gitBranchPanel?.addEventListener("click", (event) => {
      if (event.target !== gitBranchPanel) return;
      event.preventDefault();
      event.stopPropagation();
      closeGitBranchSheet();
    });
    headerRoot?.addEventListener("click", (event) => {
      if (!attachedFilesPanel?.classList.contains("attached-files-mode-preview")) return;
      if (event.defaultPrevented) return;
      if (event.target.closest(".hub-page-menu-btn, .hub-page-menu-panel, button, a, details, summary, input, textarea, select, label, [role='button']")) {
        return;
      }
      closeAttachedFilesRepoPreview();
    });
    const closeQuickMore = () => {
      if (quickMore) quickMore.open = false;
      closePlusMenu();
      closeHeaderMenus();
    };
    window.addEventListener("resize", () => {
      if (hasOpenHeaderMenu()) updateHeaderMenuViewportMetrics();
      if (attachedFilesPanel && !attachedFilesPanel.hidden && typeof attachedFilesPanel._syncCategoryUi === "function") {
        attachedFilesPanel._syncCategoryUi();
      }
    });
    window.addEventListener("scroll", () => {
      if (hasOpenHeaderMenu()) updateHeaderMenuViewportMetrics();
    }, { passive: true });
    document.addEventListener("click", (event) => {
      if (quickMore && quickMore.open && !quickMore.contains(event.target)) {
        quickMore.open = false;
      }
      if (composerPlusMenu && composerPlusMenu.open && !composerPlusMenu.contains(event.target) && !event.target.closest(".target-chip")) {
        closePlusMenu();
      }
      const inRightMenu = rightMenuBtn?.contains(event.target) || rightMenuPanel?.contains(event.target);
      const inGitBranchMenu = gitBranchPanel?.contains(event.target);
      const inFilesMenu = attachedFilesPanel?.contains(event.target);
      const inPaneTraceMenu = paneTracePanel?.contains(event.target);
      const inNativeBridgeMenu = nativeHeaderMenuBridge?.contains(event.target);
      const inNativeHeaderMenu = nativeHeaderMenuSelect?.contains(event.target);
      const agentActionNativeMenu = document.getElementById("agentActionNativeMenuSelect");
      const inAgentActionMenu = agentActionNativeMenu?.contains(event.target);
      if (!inRightMenu && !inGitBranchMenu && !inFilesMenu && !inPaneTraceMenu && !inNativeBridgeMenu && !inNativeHeaderMenu && !inAgentActionMenu) {
        closeHeaderMenus();
      }
    });
    async function runForwardAction(target, { sourceNode = null, keepComposerOpen = false, keepHeaderOpen = false } = {}) {
      const action = String(target || "");
      if (!action) return;
      if (keepComposerOpen) flashComposerAction(action);
      if (action === "esc" || action === "restart" || action === "resume" || action === "ctrlc" || action === "enter") {
        if (!keepComposerOpen) closeQuickMore();
        await postShortcutCommand({ command_id: action, arg: "" });
        if (keepComposerOpen && composerPlusMenu) {
          requestAnimationFrame(() => { composerPlusMenu.open = true; });
        }
        return;
      }
      if (action === "reloadChat") {
        if (reloadInFlight) return;
        reloadInFlight = true;
        armLaunchShellGate(15000);
        const btn = sourceNode;
        if (btn) {
          btn.disabled = true;
          btn.classList.add("restarting");
          btn.textContent = "Restarting…";
        }
        const previousInstance = currentServerInstance;
        const resetReloadState = (errMsg) => {
          reloadInFlight = false;
          releaseLaunchShellGate();
          if (btn) {
            btn.disabled = false;
            btn.classList.remove("restarting");
            btn.textContent = "Reload";
          }
          if (errMsg) {
            setStatus(errMsg, true);
            setTimeout(() => setStatus(""), 3000);
          }
        };
        await Promise.allSettled([purgeChatAssetCaches(), refreshChatServiceWorkers()]);
        let res;
        try {
          res = await fetch("/new-chat", { method: "POST", cache: "no-store" });
        } catch (err) {
          resetReloadState(err?.message || "reload failed");
          return;
        }
        if (!res.ok) {
          let errMsg = "reload failed";
          try { const d = await res.json(); errMsg = d?.error || errMsg; } catch (_) {}
          resetReloadState(errMsg);
          return;
        }
        const ready = await waitForChatReady(12000, previousInstance);
        await Promise.allSettled([purgeChatAssetCaches(), refreshChatServiceWorkers()]);
        if (!ready) {
          resetReloadState("reload timed out");
          return;
        }
        navigateToFreshChat();
        return;
      }
      if (action === "openGitBranchMenu") {
        openGitBranchSheet();
        return;
      }
      if (action === "openAttachedFilesMenu") {
        openAttachedFilesSheet();
        return;
      }
      if (action === "openPaneTraceWindow") {
        closeQuickMore();
        togglePaneViewer();
        return;
      }
      if (action === "addAgent") {
        closeQuickMore();
        if (!sessionActive) {
          setStatus("archived session is read-only", true);
          setTimeout(() => setStatus(""), 2000);
          return;
        }
        showAddAgentModal();
        return;
      }
      if (action === "removeAgent") {
        closeQuickMore();
        if (!sessionActive) {
          setStatus("archived session is read-only", true);
          setTimeout(() => setStatus(""), 2000);
          return;
        }
        showRemoveAgentModal();
        return;
      }
      document.getElementById(action)?.click();
      if (keepComposerOpen && composerPlusMenu) {
        requestAnimationFrame(() => { composerPlusMenu.open = true; });
      }
      if (keepHeaderOpen && rightMenuPanel && rightMenuBtn) {
        requestAnimationFrame(() => {
          rightMenuPanel.hidden = false;
          rightMenuPanel.classList.add("open");
          rightMenuBtn.classList.add("open");
        });
      }
    }
    document.querySelectorAll("[data-forward-action]").forEach((node) => {
      node.addEventListener("mousedown", (e) => e.preventDefault());
      node.addEventListener("click", async () => {
        const target = node.dataset.forwardAction || "";
        const keepComposerOpen = !!(composerPlusMenu && composerPlusMenu.contains(node));
        const keepHeaderOpen = !!(rightMenuPanel && rightMenuPanel.contains(node));
        await runForwardAction(target, { sourceNode: node, keepComposerOpen, keepHeaderOpen });
      });
    });
    document.querySelectorAll(".quick-action:not(.quick-more-toggle):not(.plus-submenu-toggle):not([data-forward-action]):not(#cameraBtn)").forEach((node) => {
      node.addEventListener("click", async () => {
        closeQuickMore();
        const sc = node.dataset.shortcut || "";
        if (sc) {
          await postShortcutCommand({ command_id: sc, arg: "" });
        }
      });
    });
    let composing = false;
    const messageInput = document.getElementById("message");
    const sendBtn = document.querySelector(".send-btn");
