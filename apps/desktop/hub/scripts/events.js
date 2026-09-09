
    window.addEventListener("message", (event) => {
      if (event.data && event.data.type === "hub-session-error") {
        failDeskOpen(event.data.message || "open session failed");
        return;
      }
      if (event.data && event.data.type === "desktop-panel-state" && event.source === _deskChatFrame?.contentWindow) {
        updateDeskPanelButtonState(
          String(event.data.mode || ""),
          Number(event.data.width || 0),
        );
        return;
      }
      if (event.data && event.data.type === "open-external-url" && event.source === _deskChatFrame?.contentWindow) {
        const invoke = getTauriInvoke();
        if (typeof invoke !== "function") {
          event.source?.postMessage({ type: "external-url-open-failed" }, "*");
          return;
        }
        invoke("open_external_url", { url: String(event.data.url || "") }).catch(() => {
          event.source?.postMessage({ type: "external-url-open-failed" }, "*");
        });
        return;
      }
      if (event.data && event.data.type === "show-chat-header-menu") {
        const invoke = getTauriInvoke();
        if (typeof invoke !== "function") return;
        const childPayload = event.data.payload || {};
        const frameRect = _deskChatFrame?.getBoundingClientRect?.() || { left: 0, top: 0 };
        invoke("show_chat_header_menu", {
          payload: {
            ...childPayload,
            x: Math.round(Number(childPayload.x || 0) + Number(frameRect.left || 0)),
            y: Math.round(Number(childPayload.y || 0) + Number(frameRect.top || 0)),
          },
        }).catch(() => {});
        return;
      }
      if (event.data && event.data.type === "show-file-context-menu" && event.source === _deskChatFrame?.contentWindow) {
        const invoke = getTauriInvoke();
        const childPayload = event.data.payload || {};
        const frameRect = _deskChatFrame?.getBoundingClientRect?.() || { left: 0, top: 0 };
        if (typeof invoke !== "function") {
          event.source?.postMessage({ type: "file-context-menu-error", message: "Native file menu is unavailable." }, "*");
          return;
        }
        invoke("show_file_context_menu", {
          payload: {
            x: Math.round(Number(childPayload.x || 0) + Number(frameRect.left || 0)),
            y: Math.round(Number(childPayload.y || 0) + Number(frameRect.top || 0)),
            revealEnabled: !!childPayload.revealEnabled,
          },
        }).catch((err) => {
          event.source?.postMessage({ type: "file-context-menu-error", message: String(err || "Failed to open file menu.") }, "*");
        });
        return;
      }
      if (event.data === "hub_close_chat") {
        showDeskSidebarList({ open: true });
        return;
      }
      if (event.data && event.data.type === "toggle-hub-sidebar") {
        toggleDeskSidebar();
        return;
      }
      if (event.data && event.data.type === "toggle-desktop-right-panel") {
        toggleDeskRightPanel();
        return;
      }
      if (event.data && event.data.type === "toggle-hub-sidebar-outward" && event.source === _deskChatFrame?.contentWindow) {
        toggleDeskSidebarOutward();
        return;
      }
      if (event.data && event.data.type === "toggle-desktop-panel-outward" && event.source === _deskChatFrame?.contentWindow) {
        toggleDeskRightPanelOutward();
        return;
      }
      if (event.data && event.data.type === "hub-open-chat-session") {
        const chatUrl = typeof event.data.chatUrl === "string" ? event.data.chatUrl : "";
        const sessionName = typeof event.data.sessionName === "string" ? event.data.sessionName : "";
        if (chatUrl && sessionName) {
          openChatInDesk(chatUrl, sessionName);
          if (isPhoneViewport()) {
            setDeskSidebarOpen(false);
          } else {
            showDeskSidebarList({ open: true });
          }
          void refreshHubSessions(true, { skipRestore: true });
        }
        return;
      }
      if (event.data && event.data.type === "hub-theme-changed") {
        applyIncomingThemeDesktop(event.data.themeDesktop || event.data.theme);
        return;
      }
      if (event.data && event.data.type === "text-size-shortcut") {
        if (event.data.reset) {
          applyDeskTextSizeAndBroadcast(DESK_TEXT_SIZE_DEFAULT);
        } else {
          const delta = Number(event.data.delta) || 0;
          if (delta) applyDeskTextSizeAndBroadcast(currentDeskTextSizePx() + delta);
        }
        return;
      }
      if (event.data && event.data.type === "desktop-menu-shortcut") {
        if (event.data.action === "openAppearanceMenu") void openAppearanceMenu();
        else dispatchDeskNativeMenuAction({ action: String(event.data.action || "") });
        return;
      }
      if (event.data && event.data.type === "reload-shortcut") {
        if (event.data.scope === "hub") triggerDeskHubReload();
        else sendDeskChatAction("reloadChat");
        return;
      }
      if (event.data && event.data.type === "new-session-shortcut") {
        void startDeskNewSessionFlow();
        return;
      }
      if (event.data && event.data.type === "switch-session-shortcut") {
        switchToDeskActiveSession(Number(event.data.index));
        return;
      }
      if (event.data && event.data.type === "reset-window-shortcut") {
        void resetDeskWindowState();
        return;
      }
      if (event.data && event.data.type === "compact-window-shortcut") {
        void compactDeskWindowState();
        return;
      }
      if (event.data && event.data.type === "mini-window-shortcut") {
        void compactDeskWindowState("mini_window_geometry", "mini window");
        return;
      }
      if (event.data && event.data.type === "always-on-top-shortcut") {
        toggleDeskAlwaysOnTop();
        return;
      }
      if (event.data && event.data.type === "auto-window-height-shortcut") {
        void toggleDeskAutoWindowHeight();
        return;
      }
      if (event.data && event.data.type === "fit-collapse-shortcut") {
        toggleDeskFitCollapsed();
        return;
      }
      if (event.data && event.data.type === "move-window-shortcut") {
        void moveDeskWindowToSpot(String(event.data.command || ""));
        return;
      }
      if (event.data && event.data.type === "fit-window-height" && event.source === _deskChatFrame?.contentWindow) {
        fitDeskWindowHeight(event.data.contentHeight, { restore: !!event.data.restore });
        return;
      }
      if (event.data && event.data.type === "open-hub-path") {
        const nextUrl = typeof event.data.url === "string" ? event.data.url : "";
        if (!nextUrl) return;
        window.location.href = nextUrl;
      }
    });
    document.addEventListener("dragenter", (event) => {
      if (!deskDtHasFiles(event.dataTransfer) || isDeskChatFrameDropTarget(event.target)) return;
      showDeskAttachDrag();
    }, true);
    document.addEventListener("dragover", (event) => {
      if (!deskDtHasFiles(event.dataTransfer) || isDeskChatFrameDropTarget(event.target)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      showDeskAttachDrag();
    }, true);
    document.addEventListener("dragleave", (event) => {
      if (!deskDtHasFiles(event.dataTransfer) || isDeskChatFrameDropTarget(event.target)) return;
      const related = event.relatedTarget;
      if (!related || !document.documentElement.contains(related)) {
        hideDeskAttachDrag();
      }
    }, true);
    document.addEventListener("dragend", () => {
      hideDeskAttachDrag({ immediate: true });
    }, true);
    document.addEventListener("drop", (event) => {
      if (!deskDtHasFiles(event.dataTransfer) || isDeskChatFrameDropTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      hideDeskAttachDrag({ immediate: true });
      forwardDeskDroppedFiles(event.dataTransfer.files);
    }, true);

    _deskChatFrame && _deskChatFrame.addEventListener("load", () => {
      setDeskChatLoading(false);
      syncDeskChatShellState();
      applyDeskChatTheme();
      try {
        _deskChatFrame.contentWindow?.postMessage(
          { type: "hub-text-size-changed", textSize: currentDeskTextSizePx() },
          "*",
        );
      } catch (_) {}
      pushDeskAutoWindowHeight();
      try {
        _deskChatFrame.contentWindow?.postMessage({ type: "desktop-panel-sync-request" }, "*");
      } catch (_) {}
    });

    _deskMain && _deskMain.addEventListener("click", () => {
      if (isPhoneViewport() && isDeskSidebarOpen()) {
        setDeskSidebarOpen(false);
      }
    });
    _deskAppSidebarToggle && _deskAppSidebarToggle.addEventListener("click", (event) => {
      event.preventDefault();
      if (isDeskSidebarOpen()) {
        setDeskSidebarOpen(false);
        return;
      }
      if (_deskAutoWindowHeight) {
        void openDeskNativeSessionSwitcher();
        return;
      }
      showDeskSidebarList({ open: true });
    });
    initDeskSidebarHoverPopover();
    _deskSidebar && _deskSidebar.addEventListener("touchstart", (event) => {
      if (!isPhoneViewport() || !isDeskSidebarOpen()) return;
      const touch = event.touches[0];
      if (!touch) return;
      const rect = _deskSidebar.getBoundingClientRect();
      const fromRightEdge = rect.right - touch.clientX;
      if (fromRightEdge > DESK_SIDEBAR_CLOSE_SWIPE_EDGE_PX) return;
      _deskSidebar._closeSwipeStartX = touch.clientX;
      _deskSidebar._closeSwipeStartY = touch.clientY;
      _deskSidebar._closeSwipeTracking = true;
      _deskSidebar._closeSwipeAxis = "";
    }, { passive: true });
    _deskSidebar && _deskSidebar.addEventListener("touchmove", (event) => {
      if (!_deskSidebar._closeSwipeTracking) return;
      const touch = event.touches[0];
      if (!touch) return;
      const moveX = touch.clientX - (_deskSidebar._closeSwipeStartX || 0);
      const moveY = touch.clientY - (_deskSidebar._closeSwipeStartY || 0);
      if (!_deskSidebar._closeSwipeAxis) {
        if (Math.abs(moveY) > Math.abs(moveX) + 6) {
          _deskSidebar._closeSwipeAxis = "y";
          return;
        }
        if (Math.abs(moveX) > 8) _deskSidebar._closeSwipeAxis = "x";
      }
      if (_deskSidebar._closeSwipeAxis !== "x") return;
      _deskSidebar._closeSwipeDeltaX = moveX;
    }, { passive: true });
    const finishDeskSidebarSwipeClose = () => {
      if (!_deskSidebar || !_deskSidebar._closeSwipeTracking) return;
      const moveX = Number(_deskSidebar._closeSwipeDeltaX || 0);
      const shouldClose = _deskSidebar._closeSwipeAxis === "x" && moveX < -DESK_SIDEBAR_CLOSE_SWIPE_THRESHOLD;
      _deskSidebar._closeSwipeTracking = false;
      _deskSidebar._closeSwipeAxis = "";
      _deskSidebar._closeSwipeDeltaX = 0;
      if (shouldClose) setDeskSidebarOpen(false);
    };
    _deskSidebar && _deskSidebar.addEventListener("touchend", finishDeskSidebarSwipeClose, { passive: true });
    _deskSidebar && _deskSidebar.addEventListener("touchcancel", finishDeskSidebarSwipeClose, { passive: true });
    _deskSidebarResizer && _deskSidebarResizer.addEventListener("pointerdown", (event) => {
      if (isPhoneViewport()) return;
      event.preventDefault();
      const startWidth = currentDeskSidebarWidthPx();
      const startX = event.clientX;
      _deskSidebarResizer.setPointerCapture?.(event.pointerId);
      document.body.classList.add("desk-workbench-resizing");
      const onMove = (moveEvent) => {
        const nextWidth = startWidth + (moveEvent.clientX - startX);
        setDeskSidebarWidthFromRenderedPx(nextWidth);
      };
      const onUp = () => {
        document.body.classList.remove("desk-workbench-resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });

    setDeskSidebarWidthAtDefaultTextSize(readDeskSidebarWidthAtDefaultTextSize(), { persist: false });
    syncDeskSidebarResizerVisibility();
    try {
      sessionStorage.removeItem("hub_chat_frame");
    } catch (_) {}

    _deskNewSessionToggle && _deskNewSessionToggle.addEventListener("click", (event) => {
      event.preventDefault();
      startDeskNewSessionFlow();
    });
    _deskNewSessionToggle && _deskNewSessionToggle.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveDeskSessionSelection(event.key === "ArrowDown" ? 1 : -1, event.currentTarget, event.key === "ArrowDown" ? "before" : "after");
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      startDeskNewSessionFlow();
    });
    _deskChatMenuBtn && _deskChatMenuBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDeskChatHeaderMenu();
    });
    _deskChatReloadBtn && _deskChatReloadBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      sendDeskChatAction("reloadChat");
    });
    _deskPanelToggle && _deskPanelToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (_deskAutoWindowHeight) {
        void openDeskNativeGitChanges();
        return;
      }
      if (_deskPanelActiveMode) {
        updateDeskPanelButtonState("", 0);
        sendDeskPanelCommand("close");
        return;
      }
      updateDeskPanelButtonState("open", _deskPanelWidth);
      sendDeskPanelCommand("repo");
    });
    (function armDeskWindowTraffic() {
      const win = window.__TAURI__?.window?.getCurrentWindow?.();
      if (!_deskWindowTraffic || !win) return;
      const actions = {
        close: () => win.close(),
        minimize: () => win.minimize(),
        zoom: () => win.toggleMaximize(),
      };
      _deskWindowTraffic.querySelectorAll("[data-window-action]").forEach((button) => {
        const run = actions[button.dataset.windowAction];
        if (run) button.addEventListener("click", () => { try { void run(); } catch (_) {} });
      });
    })();
    // The Fit Height traffic-light indicator (shown only in that mode) is a
    // live stand-in for the hidden native buttons.
    (function armFitWindowDots() {
      const dotsEl = document.querySelector(".fit-window-dots");
      const win = window.__TAURI__?.window?.getCurrentWindow?.();
      if (!dotsEl || !win) return;
      const actions = [
        ["Close", () => win.close()],
        ["Minimize", () => win.minimize()],
        ["Zoom", () => win.toggleMaximize()],
      ];
      dotsEl.querySelectorAll("i").forEach((bar, i) => {
        const [label, run] = actions[i] || [];
        if (!run) return;
        bar.setAttribute("role", "button");
        bar.setAttribute("aria-label", label);
        bar.addEventListener("click", () => { try { void run(); } catch (_) {} });
      });
    })();
    _deskSettingsBtn && _deskSettingsBtn.addEventListener("click", () => { void openAppearanceMenu(); });
    _deskReloadBtn && _deskReloadBtn.addEventListener("click", triggerDeskHubReload);
    window.addEventListener("resize", updateDeskChromeOverflow, { passive: true });
    updateDeskChromeOverflow();
    if (_deskSessionList) {
      _deskSessionList.addEventListener("scroll", updateDeskSessionListFade, { passive: true });
      window.addEventListener("resize", updateDeskSessionListFade, { passive: true });
      _deskSessionList.addEventListener("contextmenu", (event) => {
        const row = event.target.closest(".desk-action-session-row");
        const invoke = getTauriInvoke();
        const sessionName = row?.dataset.sessionName || "";
        if (!sessionName || typeof invoke !== "function") return;
        event.preventDefault();
        _deskContextSessionName = sessionName;
        const rec = findSessionRecord(sessionName);
        const archived = !!(rec && rec.archived);
        const selected = sessionName === _deskSelectedSessionName;
        invoke("show_session_context_menu", {
          payload: {
            x: Math.round(event.clientX),
            y: Math.round(event.clientY),
            resetAgentsEnabled: archived && !rec.session.agents_reset,
            changeWorkspaceEnabled: archived && !selected,
            archiveEnabled: !archived,
            deleteEnabled: archived,
            reviveEnabled: archived,
          },
        }).catch((err) => {
          showDeskHubMessage(String(err || "Failed to open session menu."), { error: true });
        });
      });
      _deskSessionList.addEventListener("click", (event) => {
        const hoverAction = event.target.closest("[data-desk-hover-action]");
        if (hoverAction) {
          event.preventDefault();
          event.stopPropagation();
          const row = hoverAction.closest(".desk-session-row");
          const sessionName = row?.dataset.sessionName || "";
          const kind = hoverAction.dataset.deskHoverAction || "";
          if (sessionName && kind) {
            if (kind === "revive") {
              const href = `/revive-session?session=${encodeURIComponent(sessionName)}`;
              openSessionFrame(href, sessionName);
            } else {
              void runDeskContextAction(sessionName, kind);
            }
          }
          return;
        }
        const swipeAction = event.target.closest("[data-desk-swipe-action]");
        if (swipeAction) return;
        const row = event.target.closest(".desk-session-row");
        if (!row) return;
        const swipeRow = row.closest(".desk-swipe-row");
        if (swipeRow && swipeRow._swipeConsumedUntil && swipeRow._swipeConsumedUntil > Date.now()) {
          return;
        }
        if (swipeRow && swipeRow.dataset.swipeOpen === "1") {
          event.preventDefault();
          event.stopPropagation();
          closeDeskSwipeRow(swipeRow, true);
          return;
        }
        const href = deskSessionOpenHref(row);
        const name = row.dataset.sessionName || "";
        if (href) openSessionFrame(href, name);
      });
      _deskSessionList.addEventListener("keydown", (event) => {
        const row = event.target.closest(".desk-session-row");
        if (!row) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          moveDeskSessionSelection(event.key === "ArrowDown" ? 1 : -1, row);
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openDeskSessionRow(row);
      });
    }

    window.refreshHubSessionLists = refreshHubSessions;
    startHubSessionMessagesEvents(() => refreshHubSessions(true, { skipRestore: true }));
    consumeHubPendingError();
    if (isTauriDesktopApp() && !isPhoneViewport()) {
      // sessionStorage, not localStorage: a same-session reload keeps whatever
      // state it was in, but a fresh app launch has no entry and falls back to
      // open -- the default stays "open".
      let wantSidebarOpen = true;
      try { wantSidebarOpen = sessionStorage.getItem(DESK_SIDEBAR_OPEN_KEY) !== "0"; } catch (_) {}
      if (wantSidebarOpen) showDeskSidebarList({ open: true });
      else setDeskSidebarOpen(false);
      let wantAutoHeight = false;
      try { wantAutoHeight = sessionStorage.getItem(DESK_AUTO_HEIGHT_KEY) === "1"; } catch (_) {}
      if (wantAutoHeight) setDeskAutoWindowHeight(true);
    }
    refreshHubSessions(true);
  __HUB_HEADER_JS__
