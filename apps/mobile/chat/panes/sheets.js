    let paneViewerInterval = null;
    let paneViewerTabScrollRaf = 0;
    let paneViewerTabScrollEndTimer = null;
    let paneViewerOpenRaf = 0;
    let paneViewerInitialFetchTimer = 0;
    let lastPaneViewerTabIdx = 0;
    const gitPanel = document.getElementById("gitPanel");
    const repoPanel = document.getElementById("repoPanel");
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
      void runForwardAction(target, { sourceNode: null });
    });
    nativeHeaderMenuSelect?.addEventListener("blur", () => {
      setTimeout(clearNativeHeaderMenuSelection, 0);
    });
    const headerRoot = document.querySelector(".page-header");
    const hasOpenHeaderMenu = () => !!(gitPanel?.classList.contains("open") || repoPanel?.classList.contains("open") || paneTracePanel?.classList.contains("open"));
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
    const MOBILE_SHEET_ACTIVE_CLASS = "mobile-sheet-active";
    const buildMobileBottomSheet = ({
      kind,
      title = "",
      closeLabel = "Close",
      onClose = () => { },
      leadingButtonHtml = "",
    }) => {
      const sheet = document.createElement("div");
      sheet.className = `${kind}-sheet mobile-bottom-sheet`;
      const sheetPanel = document.createElement("div");
      sheetPanel.className = `${kind}-sheet-panel mobile-bottom-sheet-panel`;
      const sheetNav = document.createElement("div");
      sheetNav.className = `${kind}-sheet-nav mobile-bottom-sheet-nav`;
      const leading = leadingButtonHtml || "";
      sheetNav.innerHTML = `
        <div class="${kind}-sheet-pill mobile-bottom-sheet-pill"></div>
        <div class="${kind}-sheet-nav-bar mobile-bottom-sheet-nav-bar">
          ${leading}
          <div class="${kind}-sheet-title mobile-bottom-sheet-title"></div>
          <button type="button" class="${kind}-sheet-close mobile-bottom-sheet-button" aria-label="${closeLabel}">
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
    const ensureMobileSheetDom = (panel, {
      kind,
      title,
      closeLabel,
      onClose,
      leadingButtonHtml = "",
      afterBuild = null,
    }) => {
      if (!panel) return null;
      const existingContent = panel.querySelector(`.${kind}-sheet-content`);
      if (existingContent) return existingContent;
      const existing = document.createDocumentFragment();
      while (panel.firstChild) existing.appendChild(panel.firstChild);
      const built = buildMobileBottomSheet({
        kind,
        title,
        closeLabel,
        onClose,
        leadingButtonHtml,
      });
      if (existing.childNodes.length) built.contentEl.appendChild(existing);
      afterBuild?.(built);
      panel.appendChild(built.sheet);
      return built.contentEl;
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
    const repoSheet = createMobileSheetController(repoPanel, MOBILE_SHEET_ACTIVE_CLASS, {
      onClosed: () => {
        _repoPreviewPath = "";
        _repoPreviewExt = "";
        repoPanel?.classList.remove("repo-mode-preview");
        resetEmbeddedFilePreviewFrame(repoPreviewFrameEl());
      },
    });
    const closeRepoSheet = (options) => repoSheet.close(options);
    const openRepoSheet = () => {
      if (!repoPanel) return;
      if (repoPanel.classList.contains("repo-mode-preview")) {
        closeRepoPreview();
      }
      closeGitSheet({ immediate: true });
      closePaneTraceSheet({ immediate: true });
      repoSheet.open();
      if (typeof repoPanel._syncCategoryUi === "function") {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => repoPanel._syncCategoryUi());
        });
      }
    };
    const paneTraceSheet = createMobileSheetController(paneTracePanel, MOBILE_SHEET_ACTIVE_CLASS);
    const ensurePaneTraceSheetDom = () => ensureMobileSheetDom(paneTracePanel, {
      kind: "pane-trace",
      title: "Pane Trace",
      closeLabel: "Close pane trace",
      onClose: () => exitPaneTraceMode(),
    });
    const closePaneTraceSheet = ({ immediate = false } = {}) => {
      if (!paneTracePanel) return;
      paneTraceSheet.close({ immediate });
    };
    const openPaneTraceSheet = (onOpened = () => { }) => {
      if (!paneTracePanel) return;
      ensurePaneTraceSheetDom();
      paneTraceSheet.open(onOpened);
    };
    const gitSheet = createMobileSheetController(gitPanel, MOBILE_SHEET_ACTIVE_CLASS);
    const ensureGitSheetDom = () => ensureMobileSheetDom(gitPanel, {
      kind: "git",
      title: "Git",
      closeLabel: "Close git",
      onClose: () => closeGitSheet(),
    });
    const closeGitSheet = ({ immediate = false } = {}) => {
      if (!gitPanel) return;
      gitSheet.close({ immediate });
    };
    const openGitSheet = async () => {
      if (!gitPanel) return;
      closeRepoSheet({ immediate: true });
      closePaneTraceSheet({ immediate: true });
      ensureGitSheetDom();
      setGitSheetTitle("Git");
      gitSheet.open();
      await updateGitPanel();
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
    let repoSession = "";
    let repoPanelRenderSig = "";
    let repoPanelUpdateSeq = 0;
    let repoPanelEntries = [];
    let _repoBrowserPath = "";
    let _repoPreviewPath = "";
    let _repoPreviewExt = "";
    let _repoGoToParentPath = () => { };
    const repoSheetBackIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>';
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
    const repoSheetTitleEl = () => repoPanel?.querySelector(".repo-sheet-title");
    const repoSheetBackBtn = () => repoPanel?.querySelector(".repo-sheet-back");
    const repoBrowserMountEl = () => repoPanel?.querySelector(".repo-browser-mount");
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
      const navBar = backBtn.closest(".repo-sheet-nav-bar");
      if (repoPanel?.classList.contains("repo-mode-preview")) {
        navBar?.classList.remove("repo-sheet-nav-at-root");
        backBtn.disabled = false;
        backBtn.setAttribute("aria-label", "Back to directory");
        return;
      }
      const atRoot = !normalizeRepoPath(_repoBrowserPath);
      navBar?.classList.toggle("repo-sheet-nav-at-root", atRoot);
      backBtn.disabled = atRoot;
      backBtn.setAttribute("aria-label", atRoot ? "No parent directory" : "Go to parent directory");
    };
    const clearRepoPreview = () => {
      _repoPreviewPath = "";
      _repoPreviewExt = "";
      if (repoPanel) {
        delete repoPanel._previewPath;
        delete repoPanel._previewExt;
      }
      repoPanel?.classList.remove("repo-mode-preview");
      resetEmbeddedFilePreviewFrame(repoPreviewFrameEl());
      resetRepoPreviewControls();
      setRepoSheetTitle(repoBrowserTitleForPath(_repoBrowserPath));
      syncRepoSheetBackBtn();
    };
    const closeRepoPreview = () => {
      if (!_repoPreviewPath) return;
      clearRepoPreview();
    };
    const handleRepoSheetBack = () => {
      if (!repoPanel) return;
      if (repoPanel.classList.contains("repo-mode-preview")) {
        closeRepoPreview();
        return;
      }
      _repoGoToParentPath();
    };
    const ensureRepoSheetDom = () => {
      if (!repoPanel) return false;
      if (repoPanel.querySelector(".repo-sheet")) return true;
      ensureMobileSheetDom(repoPanel, {
        kind: "repo",
        title: "Repository",
        closeLabel: "Close repository",
        onClose: () => closeRepoSheet(),
        leadingButtonHtml: `<button type="button" class="repo-sheet-back mobile-bottom-sheet-button" aria-label="Go to parent directory">${repoSheetBackIcon}</button>`,
        afterBuild: ({ sheetNav, contentEl }) => {
          const stack = document.createElement("div");
          stack.className = "repo-stack";
          const browserView = document.createElement("div");
          browserView.className = "repo-browser-view";
          const browserMount = document.createElement("div");
          browserMount.className = "repo-browser-mount";
          browserView.appendChild(browserMount);
          const previewView = document.createElement("div");
          previewView.className = "repo-preview-view";
          const previewFrame = document.createElement("iframe");
          previewFrame.className = "repo-preview-frame";
          previewFrame.title = "File preview";
          previewView.appendChild(previewFrame);
          stack.append(browserView, previewView);

          sheetNav.querySelector(".repo-sheet-back")?.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            handleRepoSheetBack();
          });
          wireRepoPreviewControls(sheetNav);

          let swipeStartX = 0;
          let swipeStartY = 0;
          let swipeTracking = false;
          let swipeBackReady = false;
          const resetSwipeBack = () => {
            swipeTracking = false;
            swipeBackReady = false;
          };
          browserView.addEventListener("touchstart", (event) => {
            if (!normalizeRepoPath(_repoBrowserPath)) return;
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
            if (shouldBack) _repoGoToParentPath();
          }, { passive: true });
          browserView.addEventListener("touchcancel", resetSwipeBack, { passive: true });
          contentEl.appendChild(stack);
        },
      });
      syncRepoSheetBackBtn();
      return true;
    };
    const openRepoPreview = async (rawPath, ext) => {
      const path = normalizeRepoPath(rawPath);
      const normalizedExt = String(ext || fileExtForPath(path) || "").toLowerCase();
      if (!path || !repoPanel) return;
      if (!ensureRepoSheetDom()) return;
      if (!isPublicChatView) {
        const exists = await fileExistsOnDisk(path);
        if (!exists) {
          setStatus(`file not found: ${displayAttachmentFilename(path) || path}`, true);
          setTimeout(() => setStatus(""), 2200);
          return;
        }
      }
      const frame = repoPreviewFrameEl();
      if (!frame) return;
      const parentPath = repoParentPathForFile(path);
      const sheetOpen = repoPanel.classList.contains("open") && !repoPanel.hidden;
      if (!sheetOpen) repoSheet.open();
      if (repoPanel.classList.contains("repo-mode-preview")) {
        clearRepoPreview();
      }
      if (typeof repoPanel._openRepoPath === "function") {
        if (_repoBrowserPath !== parentPath || !repoBrowserMountEl()?.childElementCount) {
          await repoPanel._openRepoPath(parentPath);
        }
      } else {
        _repoBrowserPath = parentPath;
      }
      _repoPreviewPath = path;
      _repoPreviewExt = normalizedExt;
      repoPanel._previewPath = path;
      repoPanel._previewExt = normalizedExt;
      repoPanel.classList.add("repo-mode-preview");
      const filename = (displayAttachmentFilename(path) || path || "Preview").trim();
      setRepoSheetTitle(filename);
      syncRepoSheetBackBtn();
      initRepoPreviewControls();
      wireEmbeddedFilePreviewFrame(frame, path, normalizedExt);
    };
    if (repoPanel) repoPanel._openFilePreview = openRepoPreview;
__CHAT_INCLUDE:../features/git-panel.js__
    const updateRepoPanel = async (entries) => {
      if (!repoPanel) return;
      repoPanelEntries = Array.isArray(entries) ? entries : [];

      const normalizeRepoPath = (value) => String(value || "")
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "");
      const sessionKey = repoSession || currentSessionName || "";
      if (repoPanel._repoSessionKey !== sessionKey) {
        repoPanel._repoSessionKey = sessionKey;
        _repoBrowserPath = "";
        repoPanelRenderSig = "";
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
        if (nextRenderSig === repoPanelRenderSig && repoBrowserMountEl()?.childElementCount) return;
        repoPanelRenderSig = nextRenderSig;
        _repoBrowserPath = path;
        if (_repoPreviewPath) clearRepoPreview();
        ensureRepoSheetDom();

        const browser = document.createElement("div");
        browser.className = "repo-browser repo-browser-mobile";
        const goToParentPath = () => {
          if (!path) return;
          const parts = path.split("/").filter(Boolean);
          parts.pop();
          void openRepoPath(parts.join("/"), { transition: "back" });
        };
        _repoGoToParentPath = goToParentPath;
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
            await openRepoPreview(fileEntry.path, ext);
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
        const mount = repoBrowserMountEl();
        if (mount) mount.replaceChildren(browser);
        setRepoSheetTitle(repoBrowserTitleForPath(path));
        syncRepoSheetBackBtn();
      };

      const openRepoPath = async (rawPath, { transition = "none", preserveCurrent = false } = {}) => {
        const path = normalizeRepoPath(rawPath);
        if (repoPanel._repoSessionKey !== sessionKey) return;
        const updateSeq = ++repoPanelUpdateSeq;
        const canPreserveCurrent = !!(
          preserveCurrent
          && path === _repoBrowserPath
          && repoBrowserMountEl()?.childElementCount
        );
        if (!canPreserveCurrent) renderPanel(path, [], { loading: true, transition });
        try {
          const entriesForPath = await fetchRepoDir(path);
          if (updateSeq !== repoPanelUpdateSeq || repoPanel._repoSessionKey !== sessionKey) return;
          if (canPreserveCurrent && _repoBrowserPath !== path) return;
          renderPanel(path, entriesForPath, { transition });
        } catch (err) {
          if (updateSeq !== repoPanelUpdateSeq || repoPanel._repoSessionKey !== sessionKey) return;
          if (canPreserveCurrent) return;
          const errorText = String(err?.message || "Failed to load directory");
          if (path) {
            try {
              const rootEntries = await fetchRepoDir("");
              if (updateSeq !== repoPanelUpdateSeq || repoPanel._repoSessionKey !== sessionKey) return;
              renderPanel("", rootEntries, { transition: "back" });
              return;
            } catch (_) { }
          }
          renderPanel(path, [], { error: errorText, transition });
        }
      };

      repoPanel._syncCategoryUi = () => {
        if (repoPanel.classList.contains("repo-mode-preview")) return;
        void openRepoPath(_repoBrowserPath, { transition: "none", preserveCurrent: true });
      };
      repoPanel._openRepoPath = openRepoPath;
      repoPanel._scrollToCategory = () => false;
      const panelVisible = repoPanel.classList.contains("open") && !repoPanel.hidden;
      if (!panelVisible) return;
      if (repoPanel.classList.contains("repo-mode-preview")) return;
      await openRepoPath(_repoBrowserPath, { transition: "none", preserveCurrent: true });
    };
    const closeHeaderMenus = () => {
      resetAgentActionNativeMenu({ clearOptions: true });
      closeGitDetail();
      exitPaneTraceMode();
      closeGitSheet({ immediate: true });
      closeRepoSheet({ immediate: true });
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
      await runForwardAction(action, { sourceNode: null });
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
    repoPanel?.addEventListener("click", (event) => {
      if (event.target !== repoPanel) return;
      event.preventDefault();
      event.stopPropagation();
      closeRepoSheet();
    });
    gitPanel?.addEventListener("click", (event) => {
      if (event.target !== gitPanel) return;
      event.preventDefault();
      event.stopPropagation();
      closeGitSheet();
    });
    headerRoot?.addEventListener("click", (event) => {
      if (!repoPanel?.classList.contains("repo-mode-preview")) return;
      if (event.defaultPrevented) return;
      if (event.target.closest(".page-menu-btn, .page-menu-panel, button, a, details, summary, input, textarea, select, label, [role='button']")) {
        return;
      }
      closeRepoPreview();
    });
    window.addEventListener("resize", () => {
      syncNativeHeaderMenuSelectAnchor();
      if (hasOpenHeaderMenu()) updateHeaderMenuViewportMetrics();
      if (repoPanel && !repoPanel.hidden && typeof repoPanel._syncCategoryUi === "function") {
        repoPanel._syncCategoryUi();
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
      const inGitMenu = gitPanel?.contains(event.target);
      const inFilesMenu = repoPanel?.contains(event.target);
      const inPaneTraceMenu = paneTracePanel?.contains(event.target);
      const inNativeHeaderMenu = nativeHeaderMenuSelect?.contains(event.target);
      const agentActionNativeMenu = document.getElementById("agentActionNativeMenuSelect");
      const inAgentActionMenu = agentActionNativeMenu?.contains(event.target);
      if (!inRightMenu && !inGitMenu && !inFilesMenu && !inPaneTraceMenu && !inNativeHeaderMenu && !inAgentActionMenu) {
        closeHeaderMenus();
      }
    });
    async function runForwardAction(target, { sourceNode = null } = {}) {
      const action = String(target || "");
      if (!action) return;
      if (action === "esc" || action === "restart" || action === "resume" || action === "ctrlc" || action === "enter") {
        await postShortcutCommand({ command_id: action, arg: "" });
        return;
      }
      if (action === "reloadChat") {
        await beginNewChat(sourceNode);
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
        if (!sessionActive) {
          setStatus("archived session is read-only", true);
          setTimeout(() => setStatus(""), 2000);
          return;
        }
        showAddAgentModal();
        return;
      }
      if (action === "removeAgent") {
        if (!sessionActive) {
          setStatus("archived session is read-only", true);
          setTimeout(() => setStatus(""), 2000);
          return;
        }
        showRemoveAgentModal();
        return;
      }
      throw new Error(`unknown menu action: ${action}`);
    }

