    let _deskAlwaysOnTop = false;
    function applyDeskAlwaysOnTop(on) {
      _deskAlwaysOnTop = !!on;
      // Marks the settings button (its ⌥⌘P / menu is what toggles this).
      if (_deskAlwaysOnTop) document.documentElement.dataset.alwaysOnTop = "1";
      else delete document.documentElement.dataset.alwaysOnTop;
      const invoke = getTauriInvoke();
      if (typeof invoke === "function") {
        invoke("set_always_on_top", { on: _deskAlwaysOnTop }).catch((err) => {
          showDeskHubMessage(`always on top failed: ${err}`, { error: true });
        });
      }
    }
    function toggleDeskAlwaysOnTop() {
      applyDeskAlwaysOnTop(!_deskAlwaysOnTop);
    }

    // "Fit Height to Message" mode: on each agent-message stream completion the
    // chat frame reports the height it needs, and we resize the window to it
    // (width and x untouched). Between messages the user is free to resize.
    // Mirrors DEFAULT_WINDOW_SIZE in tauri_app/src-tauri/src/main.rs -- the
    // height Fit Height restores on exit.
    const DESK_DEFAULT_WINDOW_HEIGHT = 896;
    let _deskAutoWindowHeight = false;
    let _deskLastFitTarget = 0;
    // Set on entering Fit Height: the first fit resize also snaps the window to
    // the compact width, so entry is one motion instead of a visible width jump
    // followed by a height shrink.
    let _deskFitWidthSnapPending = false;
    function pushDeskAutoWindowHeight() {
      try {
        _deskChatFrame?.contentWindow?.postMessage(
          { type: "hub-auto-window-height", on: _deskAutoWindowHeight },
          "*",
        );
      } catch (_) {}
    }
    function applyDeskFitHeightMin() {
      const invoke = getTauriInvoke();
      if (typeof invoke === "function") {
        invoke("set_fit_height_min", { enabled: _deskAutoWindowHeight }).catch(() => {});
      }
    }
    function setDeskAutoWindowHeight(on) {
      const next = !!on;
      if (next === _deskAutoWindowHeight) return;
      _deskAutoWindowHeight = next;
      _deskLastFitTarget = 0;
      // Fit Height hides the traffic lights, so the 26px title-bar inset at the
      // top of the window can shrink to match the 4px sides.
      if (next) document.documentElement.dataset.autoWindowHeight = "1";
      else delete document.documentElement.dataset.autoWindowHeight;
      // sessionStorage, not localStorage: a same-session hub reload keeps Fit
      // Height mode, but a fresh app launch has no entry and starts off.
      try { sessionStorage.setItem(DESK_AUTO_HEIGHT_KEY, next ? "1" : "0"); } catch (_) {}
      // The window is too short for the hub sidebar in this mode; sessions are
      // switched through a native menu instead (collapsed sidebar, on click).
      if (_deskAutoWindowHeight) setDeskSidebarOpen(false);
      // Fit Height needs the window minimum height dropped to ~0.
      applyDeskFitHeightMin();
      pushDeskAutoWindowHeight();
    }
    // Entering Fit Height (⌥⌘H or the menu item) snaps the window to the
    // compact width -- the ⌥⌘9 width that always got paired with it by hand --
    // folded into the first fit resize (see _deskFitWidthSnapPending), and pins
    // the window, since Fit Height is only useful kept in front. Leaving the
    // mode unpins and restores the default height (the width and position at
    // that point are kept -- entry shrank the height, so exit grows it back).
    function toggleDeskAutoWindowHeight() {
      if (_deskAutoWindowHeight) {
        setDeskAutoWindowHeight(false);
        applyDeskAlwaysOnTop(false);
        const invoke = getTauriInvoke();
        if (typeof invoke === "function") {
          invoke("set_window_height", { height: DESK_DEFAULT_WINDOW_HEIGHT * currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT }).catch((err) => {
            showDeskHubMessage(`fit height exit resize failed: ${err}`, { error: true });
          });
        }
        return;
      }
      resetDeskChatView();
      _deskFitWidthSnapPending = true;
      setDeskAutoWindowHeight(true);
      applyDeskAlwaysOnTop(true);
    }
    function fitDeskWindowHeight(contentHeight) {
      if (!_deskAutoWindowHeight) return;
      const content = Number(contentHeight);
      if (!Number.isFinite(content) || content <= 0) return;
      const invoke = getTauriInvoke();
      if (typeof invoke !== "function" || !_deskChatFrame) return;
      const iframeH = _deskChatFrame.getBoundingClientRect().height;
      // Chrome around the chat frame (hub header + window insets). Clamped so a
      // transient bad iframe measurement can't blow the target up to full screen.
      const overhead = Math.min(240, Math.max(0, window.innerHeight - iframeH));
      const target = Math.round(content + overhead);
      // On the first fit after entering the mode, pull the window to the
      // compact width in the same resize (see toggleDeskAutoWindowHeight).
      const snapWidth = _deskFitWidthSnapPending;
      _deskFitWidthSnapPending = false;
      // The composer predict + ResizeObserver paths both fire per keystroke;
      // drop the redundant second call so it isn't two invokes per line.
      if (!snapWidth && Math.abs(target - _deskLastFitTarget) < 4) return;
      _deskLastFitTarget = target;
      invoke("set_window_height", {
        height: target,
        compactWidthScale: snapWidth ? currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT : null,
      }).catch((err) => {
        showDeskHubMessage(`fit height failed: ${err}`, { error: true });
      });
    }

    // The chat view reset (which scrolls the transcript back to the bottom) is
    // sent *after* the window geometry lands, so the chat frame measures the
    // final size -- not the pre-preset one, whatever it was.
    async function resetDeskWindowState() {
      showDeskSidebarList({ open: true });
      setDeskSidebarWidthAtDefaultTextSize(DESK_DEFAULT_SIDEBAR_WIDTH_AT_DEFAULT_TEXT_SIZE);
      setDeskAutoWindowHeight(false);
      applyDeskAlwaysOnTop(false);
      const invoke = getTauriInvoke();
      if (typeof invoke === "function") {
        try {
          await invoke("reset_window_geometry", { scale: currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT });
        } catch (err) {
          showDeskHubMessage(`reset window failed: ${err}`, { error: true });
        }
      } else {
        showDeskHubMessage("reset window: no tauri invoke available", { error: true });
      }
      resetDeskChatView();
    }

    async function compactDeskWindowState(command = "compact_window_geometry", label = "compact window") {
      setDeskSidebarOpen(false);
      setDeskAutoWindowHeight(false);
      applyDeskAlwaysOnTop(false);
      const invoke = getTauriInvoke();
      if (typeof invoke === "function") {
        try {
          await invoke(command, { scale: currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT });
        } catch (err) {
          showDeskHubMessage(`${label} failed: ${err}`, { error: true });
        }
      } else {
        showDeskHubMessage(`${label}: no tauri invoke available`, { error: true });
      }
      resetDeskChatView();
    }

    // Pure reposition -- unlike reset/compact above, this touches only the
    // window's position (size untouched, no sidebar/chat-view/height reset).
    // The command is move_window_top / _top_left / _top_right / _center.
    async function moveDeskWindowToSpot(command) {
      const invoke = getTauriInvoke();
      if (typeof invoke !== "function") {
        showDeskHubMessage(`${command}: no tauri invoke available`, { error: true });
        return;
      }
      try {
        await invoke(command);
      } catch (err) {
        showDeskHubMessage(`${command} failed: ${err}`, { error: true });
      }
    }

    async function resizeDeskWindowAroundPane({ edge, delta, apply, rollback, label }) {
      if (_deskOutwardResizeInFlight || _deskAutoWindowHeight) return;
      const invoke = getTauriInvoke();
      if (typeof invoke !== "function") {
        showDeskHubMessage(`${label}: no tauri invoke available`, { error: true });
        return;
      }
      _deskOutwardResizeInFlight = true;
      let applied = false;
      try {
        const resizing = invoke("resize_window_from_edge", { edge, delta });
        apply();
        applied = true;
        await resizing;
      } catch (err) {
        if (applied) rollback();
        showDeskHubMessage(`${label} failed: ${err}`, { error: true });
      } finally {
        _deskOutwardResizeInFlight = false;
      }
    }

    function toggleDeskSidebar() {
      // Fit Height collapses the sidebar to a native menu -- open that instead.
      if (_deskAutoWindowHeight) { void openDeskNativeSessionSwitcher(); return; }
      setDeskSidebarOpen(!isDeskSidebarOpen());
    }

    function toggleDeskRightPanel() {
      if (_deskAutoWindowHeight) { void openDeskNativeGitChanges(); return; }
      sendDeskPanelCommand("");
    }

    function toggleDeskSidebarOutward() {
      if (_deskAutoWindowHeight) return;
      const opening = !isDeskSidebarOpen();
      const width = currentDeskSidebarWidthPx();
      void resizeDeskWindowAroundPane({
        edge: "left",
        delta: opening ? width : -width,
        apply: () => setDeskSidebarOpen(opening),
        rollback: () => setDeskSidebarOpen(!opening),
        label: "toggle Hub sidebar outward",
      });
    }

    function toggleDeskRightPanelOutward() {
      if (_deskAutoWindowHeight) return;
      const width = _deskPanelWidth;
      if (!(width > 0)) {
        showDeskHubMessage("toggle right pane outward: pane width unavailable", { error: true });
        return;
      }
      const opening = !_deskPanelActiveMode;
      void resizeDeskWindowAroundPane({
        edge: "right",
        delta: opening ? width : -width,
        apply: () => {
          updateDeskPanelButtonState(opening ? "open" : "", width);
          sendDeskPanelCommand("");
        },
        rollback: () => {
          updateDeskPanelButtonState(opening ? "" : "open", width);
          sendDeskPanelCommand("");
        },
        label: "toggle right pane outward",
      });
    }

    window.addEventListener("keydown", (event) => {
      if (event.metaKey && event.altKey) {
        if (event.code === "KeyB") {
          event.preventDefault();
          toggleDeskSidebarOutward();
          return;
        }
        if (event.code === "KeyE") {
          event.preventDefault();
          toggleDeskRightPanelOutward();
          return;
        }
        if (event.code === "KeyT") {
          event.preventDefault();
          dispatchDeskNativeMenuAction({ action: "openTerminal" });
          return;
        }
        if (event.code === "KeyP") {
          event.preventDefault();
          toggleDeskAlwaysOnTop();
          return;
        }
        if (event.code === "KeyH") {
          event.preventDefault();
          void toggleDeskAutoWindowHeight();
          return;
        }
        if (event.code === "KeyR") {
          event.preventDefault();
          dispatchDeskNativeMenuAction({ action: "openFinder" });
          return;
        }
        if (event.code === "ArrowUp") {
          event.preventDefault();
          void moveDeskWindowToSpot("move_window_top");
          return;
        }
        if (event.code === "ArrowLeft") {
          event.preventDefault();
          void moveDeskWindowToSpot("move_window_top_left");
          return;
        }
        if (event.code === "ArrowRight") {
          event.preventDefault();
          void moveDeskWindowToSpot("move_window_top_right");
          return;
        }
        if (event.code === "ArrowDown") {
          event.preventDefault();
          void moveDeskWindowToSpot("move_window_center");
          return;
        }
      }
      if (event.metaKey && event.altKey && (event.code === "Digit0" || event.key === "0")) {
        event.preventDefault();
        void resetDeskWindowState();
        return;
      }
      if (event.metaKey && event.altKey && (event.code === "Digit9" || event.key === "9")) {
        event.preventDefault();
        void compactDeskWindowState();
        return;
      }
      if (event.metaKey && event.altKey && (event.code === "Digit8" || event.key === "8")) {
        event.preventDefault();
        void compactDeskWindowState("mini_window_geometry", "mini window");
        return;
      }
      if (event.metaKey && event.code === "Comma") {
        event.preventDefault();
        void openAppearanceMenu();
        return;
      }
      // In-app view toggles: plain ⌘ (like ⌘, and the text-size chords), not
      // the ⌥⌘ family that resizes/moves the window. In Fit Height both panels
      // are native menus, so these open those instead (see toggleDesk* above).
      if (event.metaKey && !event.altKey && event.code === "KeyB") {
        event.preventDefault();
        toggleDeskSidebar();
        return;
      }
      if (event.metaKey && !event.altKey && event.code === "KeyE") {
        event.preventDefault();
        toggleDeskRightPanel();
        return;
      }
      if (event.metaKey && !event.altKey && !event.shiftKey && !event.ctrlKey && event.code === "KeyT") {
        event.preventDefault();
        dispatchDeskNativeMenuAction({ action: "openShell" });
        return;
      }
      if (event.metaKey && !event.altKey && !event.ctrlKey && event.code === "KeyR") {
        event.preventDefault();
        if (event.shiftKey) triggerDeskHubReload();
        else sendDeskChatAction("reloadChat");
        return;
      }
      if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && event.code === "KeyN") {
        event.preventDefault();
        void startDeskNewSessionFlow();
        return;
      }
      if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && /^Digit[1-9]$/.test(event.code || "")) {
        event.preventDefault();
        switchToDeskActiveSession(Number(event.code.slice(5)) - 1);
        return;
      }
      if (event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey && event.code === "KeyP") {
        event.preventDefault();
        postDeskChatFrameMessage({ type: "toggle-git-pin" });
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      // event.code (physical key) instead of event.key: with metaKey held,
      // some WebViews don't reliably report the shift-modified character for
      // "=" (i.e. "+"), so matching on .key alone silently misses ⌘+. Also
      // accept "Semicolon": on JIS keyboards the physical key that types "+"
      // reports code "Semicolon", not "Equal" (confirmed via live testing).
      if (event.code === "Equal" || event.code === "Semicolon" || event.key === "=" || event.key === "+") {
        event.preventDefault();
        applyDeskTextSizeAndBroadcast(currentDeskTextSizePx() + 1);
      } else if (event.code === "Minus" || event.key === "-" || event.key === "_") {
        event.preventDefault();
        applyDeskTextSizeAndBroadcast(currentDeskTextSizePx() - 1);
      } else if (event.code === "Digit0" || event.key === "0") {
        event.preventDefault();
        applyDeskTextSizeAndBroadcast(DESK_TEXT_SIZE_DEFAULT);
      }
    });

    async function openAppearanceMenu() {
      const invoke = getTauriInvoke();
      if (typeof invoke !== "function" || !_deskSettingsBtn) return;
      const rect = _deskSettingsBtn.getBoundingClientRect();
      _deskSettingsBtn.classList.add("is-active");
      try {
        await invoke("show_appearance_menu", {
          payload: {
            x: Math.round(rect.left || 0),
            y: Math.round((rect.bottom || 0) + 2),
            themeDesktop: document.documentElement.dataset.themeDesktop || "dark",
            textSize: currentDeskTextSizePx(),
            textSizeDefault: DESK_TEXT_SIZE_DEFAULT,
            alwaysOnTop: _deskAlwaysOnTop,
            autoWindowHeight: _deskAutoWindowHeight,
          },
        });
      } catch (_) {
      } finally {
        _deskSettingsBtn.classList.remove("is-active");
      }
    }
