
    window.addEventListener("message", (event) => {
      if (event.data && event.data.type === "side-bar-state" && event.source === _deskTimelineFrame?.contentWindow) {
        updateDeskSideBarButtonState(
          String(event.data.mode || ""),
          Number(event.data.width || 0),
        );
        if (event.data.side === "left") document.documentElement.dataset.sideBarPosition = "left";
        else delete document.documentElement.dataset.sideBarPosition;
        return;
      }
      if (event.data && event.data.type === "git-tree-label" && event.source === _deskTimelineFrame?.contentWindow) {
        _deskTreeLabelText = String(event.data.label || "");
        _deskTreeFollow = !!event.data.follow;
        fitDeskTreeLabel();
        return;
      }
      if (event.data && event.data.type === "timeline-hud-visible" && event.source === _deskTimelineFrame?.contentWindow) {
        if (event.data.visible) document.documentElement.dataset.timelineHud = "1";
        else delete document.documentElement.dataset.timelineHud;
        return;
      }
      if (event.data && event.data.type === "open-external-url" && event.source === _deskTimelineFrame?.contentWindow) {
        const invoke = getNativeInvoke();
        if (typeof invoke !== "function") {
          event.source?.postMessage({ type: "external-url-open-failed" }, "*");
          return;
        }
        invoke("open_external_url", { url: String(event.data.url || "") }).catch(() => {
          event.source?.postMessage({ type: "external-url-open-failed" }, "*");
        });
        return;
      }
      if (event.data && event.data.type === "show-timeline-header-menu") {
        const invoke = getNativeInvoke();
        const childPayload = event.data.payload || {};
        if (typeof invoke !== "function") {
          openTimelineMenu(_deskTimelineMenuBtn, childPayload, (payload) => {
            _deskTimelineFrame?.contentWindow?.postMessage({ type: "native-menu-action", payload }, "*");
          });
          return;
        }
        const frameRect = _deskTimelineFrame?.getBoundingClientRect?.() || { left: 0, top: 0 };
        invoke("show_timeline_header_menu", {
          payload: {
            ...childPayload,
            x: Math.round(Number(childPayload.x || 0) + Number(frameRect.left || 0)),
            y: Math.round(Number(childPayload.y || 0) + Number(frameRect.top || 0)),
          },
        }).catch((err) => reportHubError("Timeline menu failed", err));
        return;
      }
      if (event.data && event.data.type === "show-file-context-menu" && event.source === _deskTimelineFrame?.contentWindow) {
        const invoke = getNativeInvoke();
        const childPayload = event.data.payload || {};
        const frameRect = _deskTimelineFrame?.getBoundingClientRect?.() || { left: 0, top: 0 };
        if (typeof invoke !== "function") {
          event.source?.postMessage({ type: "file-context-menu-error", message: "Native file menu is unavailable." }, "*");
          return;
        }
        invoke("show_file_context_menu", {
          payload: {
            x: Math.round(Number(childPayload.x || 0) + Number(frameRect.left || 0)),
            y: Math.round(Number(childPayload.y || 0) + Number(frameRect.top || 0)),
            openFile: !!childPayload.openFile,
          },
        }).catch((err) => {
          event.source?.postMessage({ type: "file-context-menu-error", message: String(err || "File menu failed") }, "*");
        });
        return;
      }
      if (event.data && event.data.type === "copy-files-to-clipboard" && event.source === _deskTimelineFrame?.contentWindow) {
        const invoke = getNativeInvoke();
        if (typeof invoke !== "function") {
          event.source?.postMessage({ type: "file-copy-result", error: "Native file copy is unavailable." }, "*");
          return;
        }
        invoke("copy_files_to_clipboard", { paths: event.data.paths }).then(() => {
          event.source?.postMessage({ type: "file-copy-result" }, "*");
        }).catch((err) => {
          event.source?.postMessage({ type: "file-copy-result", error: String(err || "Copy failed") }, "*");
        });
        return;
      }
      if (event.data && event.data.type === "open-quick-look" && event.source === _deskTimelineFrame?.contentWindow) {
        const invoke = getNativeInvoke();
        if (typeof invoke !== "function") {
          event.source?.postMessage({ type: "quick-look-error", message: "Quick Look is unavailable." }, "*");
          return;
        }
        invoke("open_quick_look", { paths: event.data.paths }).catch((err) => {
          event.source?.postMessage({ type: "quick-look-error", message: String(err || "Quick Look failed") }, "*");
        });
        return;
      }
      if (event.data && event.data.type === "show-commit-context-menu" && event.source === _deskTimelineFrame?.contentWindow) {
        const invoke = getNativeInvoke();
        const childPayload = event.data.payload || {};
        const frameRect = _deskTimelineFrame?.getBoundingClientRect?.() || { left: 0, top: 0 };
        if (typeof invoke !== "function") {
          event.source?.postMessage({ type: "file-context-menu-error", message: "Native commit menu is unavailable." }, "*");
          return;
        }
        invoke("show_commit_context_menu", {
          payload: {
            x: Math.round(Number(childPayload.x || 0) + Number(frameRect.left || 0)),
            y: Math.round(Number(childPayload.y || 0) + Number(frameRect.top || 0)),
          },
        }).catch((err) => {
          event.source?.postMessage({ type: "file-context-menu-error", message: String(err || "Failed to open commit menu.") }, "*");
        });
        return;
      }
      if (event.data === "hub_close_timeline") {
        showDeskHubList({ open: true });
        return;
      }
      if (event.data && event.data.type === "toggle-hub") {
        toggleDeskHub();
        return;
      }
      if (event.data && event.data.type === "toggle-side-bar") {
        toggleDeskSideBar();
        return;
      }
      if (event.data && event.data.type === "toggle-hub-outward" && event.source === _deskTimelineFrame?.contentWindow) {
        toggleDeskHubOutward();
        return;
      }
      if (event.data && event.data.type === "toggle-side-bar-outward" && event.source === _deskTimelineFrame?.contentWindow) {
        toggleDeskSideBarOutward();
        return;
      }
      if (event.data && event.data.type === "hub-open-timeline") {
        const timelineUrl = typeof event.data.timelineUrl === "string" ? event.data.timelineUrl : "";
        const timelineName = typeof event.data.timelineName === "string" ? event.data.timelineName : "";
        if (timelineUrl && timelineName) {
          openTimelineInDesk(timelineUrl, timelineName);
          if (isPhoneViewport()) {
            setDeskHubOpen(false);
          } else {
            showDeskHubList({ open: true });
          }
          void refreshHubTimelines(true, { skipRestore: true });
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
        else if (event.data.action === "openTimelineHeaderMenu") openDeskTimelineHeaderMenu();
        else window.dispatchEvent(new CustomEvent("native-menu-action", { detail: { action: String(event.data.action || "") } }));
        return;
      }
      if (event.data && event.data.type === "reload-shortcut") {
        if (event.data.scope === "hub") triggerDeskHubReload();
        else sendDeskTimelineAction("reloadTimeline");
        return;
      }
      if (event.data && event.data.type === "new-timeline-shortcut") {
        void startDeskNewTimelineFlow();
        return;
      }
      if (event.data && event.data.type === "switch-timeline-shortcut") {
        switchToDeskActiveTimeline(Number(event.data.index));
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
      if (event.data && event.data.type === "fit-window-height" && event.source === _deskTimelineFrame?.contentWindow) {
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
      if (!deskDtHasFiles(event.dataTransfer) || isDeskTimelineFrameDropTarget(event.target)) return;
      showDeskAttachDrag();
    }, true);
    document.addEventListener("dragover", (event) => {
      if (!deskDtHasFiles(event.dataTransfer) || isDeskTimelineFrameDropTarget(event.target)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      showDeskAttachDrag();
    }, true);
    document.addEventListener("dragleave", (event) => {
      if (!deskDtHasFiles(event.dataTransfer) || isDeskTimelineFrameDropTarget(event.target)) return;
      const related = event.relatedTarget;
      if (!related || !document.documentElement.contains(related)) {
        hideDeskAttachDrag();
      }
    }, true);
    document.addEventListener("dragend", () => {
      hideDeskAttachDrag({ immediate: true });
    }, true);
    document.addEventListener("drop", (event) => {
      if (!deskDtHasFiles(event.dataTransfer) || isDeskTimelineFrameDropTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      hideDeskAttachDrag({ immediate: true });
      forwardDeskDroppedFiles(event.dataTransfer.files);
    }, true);

    _deskTimelineFrame && _deskTimelineFrame.addEventListener("load", () => {
      delete document.documentElement.dataset.timelineHud;
      setDeskTimelineLoading(false);
      if (_deskTimelineFrameLoadedUrl) {
        const frameDoc = _deskTimelineFrame.contentDocument;
        if (!frameDoc?.getElementById("timelineHud")) {
          failDeskOpen((frameDoc?.body?.innerText || "").trim().split("\n")[0] || "Empty response");
          return;
        }
        setResidentStatus("timeline-open", "");
      }
      syncDeskTimelineShellState();
      applyDeskTimelineTheme();
      _deskTimelineFrame.contentWindow?.postMessage(
        { type: "hub-text-size-changed", textSize: currentDeskTextSizePx() },
        "*",
      );
      pushDeskAutoWindowHeight();
      _deskTimelineFrame.contentWindow?.postMessage({ type: "side-bar-sync-request" }, "*");
    });

    _deskMain && _deskMain.addEventListener("click", () => {
      if (isPhoneViewport() && isDeskHubOpen()) {
        setDeskHubOpen(false);
      }
    });
    _deskAppSidebarToggle && _deskAppSidebarToggle.addEventListener("click", (event) => {
      event.preventDefault();
      if (event.altKey && !_deskAutoWindowHeight && getNativeInvoke()) { toggleDeskHubOutward(); return; }
      if (isDeskHubOpen()) {
        toggleDeskHub();
        return;
      }
      if (_deskAutoWindowHeight) {
        void openDeskNativeTimelineSwitcher();
        return;
      }
      showDeskHubList({ open: true });
    });
    initDeskHubHoverPopover();
    _deskHub && _deskHub.addEventListener("touchstart", (event) => {
      if (!isPhoneViewport() || !isDeskHubOpen()) return;
      const touch = event.touches[0];
      if (!touch) return;
      const rect = _deskHub.getBoundingClientRect();
      const fromRightEdge = rect.right - touch.clientX;
      if (fromRightEdge > DESK_HUB_CLOSE_SWIPE_EDGE_PX) return;
      _deskHub._closeSwipeStartX = touch.clientX;
      _deskHub._closeSwipeStartY = touch.clientY;
      _deskHub._closeSwipeTracking = true;
      _deskHub._closeSwipeAxis = "";
    }, { passive: true });
    _deskHub && _deskHub.addEventListener("touchmove", (event) => {
      if (!_deskHub._closeSwipeTracking) return;
      const touch = event.touches[0];
      if (!touch) return;
      const moveX = touch.clientX - (_deskHub._closeSwipeStartX || 0);
      const moveY = touch.clientY - (_deskHub._closeSwipeStartY || 0);
      if (!_deskHub._closeSwipeAxis) {
        if (Math.abs(moveY) > Math.abs(moveX) + 6) {
          _deskHub._closeSwipeAxis = "y";
          return;
        }
        if (Math.abs(moveX) > 8) _deskHub._closeSwipeAxis = "x";
      }
      if (_deskHub._closeSwipeAxis !== "x") return;
      _deskHub._closeSwipeDeltaX = moveX;
    }, { passive: true });
    const finishDeskHubSwipeClose = () => {
      if (!_deskHub || !_deskHub._closeSwipeTracking) return;
      const moveX = Number(_deskHub._closeSwipeDeltaX || 0);
      const shouldClose = _deskHub._closeSwipeAxis === "x" && moveX < -DESK_HUB_CLOSE_SWIPE_THRESHOLD;
      _deskHub._closeSwipeTracking = false;
      _deskHub._closeSwipeAxis = "";
      _deskHub._closeSwipeDeltaX = 0;
      if (shouldClose) setDeskHubOpen(false);
    };
    _deskHub && _deskHub.addEventListener("touchend", finishDeskHubSwipeClose, { passive: true });
    _deskHub && _deskHub.addEventListener("touchcancel", finishDeskHubSwipeClose, { passive: true });
    _deskHubResizer && _deskHubResizer.addEventListener("pointerdown", (event) => {
      if (isPhoneViewport()) return;
      event.preventDefault();
      const startWidth = currentDeskHubWidthPx();
      const startX = event.clientX;
      _deskHubResizer.setPointerCapture?.(event.pointerId);
      document.body.classList.add("desk-workbench-resizing");
      const onMove = (moveEvent) => {
        const nextWidth = startWidth + (moveEvent.clientX - startX);
        setDeskHubWidthFromRenderedPx(nextWidth);
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

    setDeskHubWidthAtDefaultTextSize(readDeskHubWidthAtDefaultTextSize(), { persist: false });
    syncDeskHubResizerVisibility();
    sessionStorage.removeItem("hub_timeline_frame");

    _deskNewTimelineToggle && _deskNewTimelineToggle.addEventListener("click", (event) => {
      event.preventDefault();
      startDeskNewTimelineFlow();
    });
    _deskNewTimelineToggle && _deskNewTimelineToggle.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveDeskTimelineSelection(event.key === "ArrowDown" ? 1 : -1, event.currentTarget, event.key === "ArrowDown" ? "before" : "after");
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      startDeskNewTimelineFlow();
    });
    _deskTimelineMenuBtn && _deskTimelineMenuBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDeskTimelineHeaderMenu();
    });
    _deskTimelineReloadBtn && _deskTimelineReloadBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      sendDeskTimelineAction("reloadTimeline");
    });
    _deskSideBarToggle && _deskSideBarToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.altKey && !_deskAutoWindowHeight && getNativeInvoke()) { toggleDeskSideBarOutward(); return; }
      if (_deskSideBarActiveMode) {
        sendDeskSideBarCommand("close");
        return;
      }
      sendDeskSideBarCommand("repo");
    });
    {
      const hint = document.getElementById("deskPaneDirectionHint");
      let hovered = false;
      let altHeld = false;
      const hideHint = () => { if (hint) hint.hidden = true; };
      const updateHint = () => {
        if (!hint || !hovered || !_deskTimelineFrameLoadedUrl || _deskSideBarActiveMode) { hideHint(); return; }
        const side = document.documentElement.dataset.sideBarPosition === "left" ? "left" : "right";
        const outward = altHeld && !_deskAutoWindowHeight && !!getNativeInvoke();
        hint.dataset.direction = side === "left" ? outward ? "left" : "right" : outward ? "right" : "left";
        const rect = _deskTimelineFrame.getBoundingClientRect();
        hint.style.left = `${Math.round(side === "left" ? rect.left + 22 : rect.right - 22)}px`;
        hint.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
        hint.hidden = false;
      };
      _deskSideBarToggle?.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "touch") return;
        hovered = true;
        altHeld = event.altKey;
        updateHint();
      });
      _deskSideBarToggle?.addEventListener("mousemove", (event) => {
        if (!hovered || (altHeld === event.altKey && !hint.hidden)) return;
        altHeld = event.altKey;
        updateHint();
      });
      _deskSideBarToggle?.addEventListener("pointerleave", () => { hovered = false; hideHint(); });
      _deskSideBarToggle?.addEventListener("click", hideHint);
      window.addEventListener("keydown", (event) => {
        if (hovered && event.key === "Alt") { altHeld = true; updateHint(); }
      });
      window.addEventListener("keyup", (event) => {
        if (hovered && event.key === "Alt") { altHeld = false; updateHint(); }
      });
      window.addEventListener("blur", () => { hovered = false; hideHint(); });
      window.addEventListener("resize", updateHint);
    }
    (function armDeskWindowTraffic() {
      const invoke = getNativeInvoke();
      if (!_deskWindowTraffic || !invoke) return;
      const actions = {
        close: () => invoke("close_window"),
        minimize: () => invoke("minimize_window"),
        zoom: () => invoke("toggle_maximize_window"),
      };
      _deskWindowTraffic.querySelectorAll("[data-window-action]").forEach((button) => {
        const run = actions[button.dataset.windowAction];
        if (run) button.addEventListener("click", () => { try { void run(); } catch (_) {} });
      });
    })();
    (function armFitWindowDots() {
      const dotsEl = document.querySelector(".fit-window-dots");
      const invoke = getNativeInvoke();
      if (!dotsEl || !invoke) return;
      const actions = [
        ["Close", () => invoke("close_window")],
        ["Minimize", () => invoke("minimize_window")],
        ["Zoom", () => invoke("toggle_maximize_window")],
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
    if (_deskTimelineList) {
      _deskTimelineList.addEventListener("scroll", updateDeskTimelineListFade, { passive: true });
      window.addEventListener("resize", updateDeskTimelineListFade, { passive: true });
      _deskTimelineList.addEventListener("contextmenu", (event) => {
        const row = event.target.closest(".desk-action-timeline-row");
        const invoke = getNativeInvoke();
        const timelineName = row?.dataset.timelineName || "";
        if (!timelineName || typeof invoke !== "function") return;
        event.preventDefault();
        _deskContextTimelineName = timelineName;
        const rec = findTimelineRecord(timelineName);
        const archived = !!(rec && rec.archived);
        const selected = timelineName === _deskSelectedTimelineName;
        invoke("show_timeline_context_menu", {
          payload: {
            x: Math.round(event.clientX),
            y: Math.round(event.clientY),
            resetAgentsEnabled: archived && rec.timeline.has_agents,
            changeWorkspaceEnabled: archived && !selected,
            archiveEnabled: !archived,
            deleteEnabled: archived,
            reviveEnabled: archived,
          },
        }).catch((err) => {
          reportHubError("Failed to open timeline menu", err);
        });
      });
      attachDeskTimelineStatsHover(_deskTimelineList);
      _deskTimelineList.addEventListener("click", (event) => {
        const hoverAction = event.target.closest("[data-desk-hover-action]");
        if (hoverAction) {
          event.preventDefault();
          event.stopPropagation();
          const row = hoverAction.closest(".desk-timeline-row");
          const timelineName = row?.dataset.timelineName || "";
          const kind = hoverAction.dataset.deskHoverAction || "";
          if (timelineName && kind) {
            if (kind === "revive") {
              const href = `/revive-timeline?timeline=${encodeURIComponent(timelineName)}`;
              openTimelineFrame(href, timelineName);
            } else {
              void runDeskContextAction(timelineName, kind);
            }
          }
          return;
        }
        const swipeAction = event.target.closest("[data-desk-swipe-action]");
        if (swipeAction) return;
        const row = event.target.closest(".desk-timeline-row");
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
        const href = deskTimelineOpenHref(row);
        const name = row.dataset.timelineName || "";
        if (href) openTimelineFrame(href, name);
      });
      _deskTimelineList.addEventListener("keydown", (event) => {
        const row = event.target.closest(".desk-timeline-row");
        if (!row) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          moveDeskTimelineSelection(event.key === "ArrowDown" ? 1 : -1, row);
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openDeskTimelineRow(row);
      });
    }

    window.refreshHubTimelineLists = refreshHubTimelines;
    startHubTimelineMessagesEvents(() => refreshHubTimelines(true, { skipRestore: true }));
    consumeHubPendingError();
    if (isNativeApp() && !isPhoneViewport()) {
      if (sessionStorage.getItem(DESK_HUB_OPEN_KEY) !== "0") showDeskHubList({ open: true });
      else setDeskHubOpen(false);
      if (sessionStorage.getItem(DESK_AUTO_HEIGHT_KEY) === "1") setDeskAutoWindowHeight(true);
    }
    refreshHubTimelines(true);
  __HUB_HEADER_JS__
