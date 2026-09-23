    let _deskAlwaysOnTop = false;
    function applyDeskAlwaysOnTop(on) {
      _deskAlwaysOnTop = !!on;
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

    const DESK_DEFAULT_WINDOW_HEIGHT = 896;
    let _deskAutoWindowHeight = false;
    let _deskLastFitTarget = 0;
    let _deskFitWidthSnapPending = false;
    let _deskFitCollapsed = false;
    const DESK_COLLAPSED_FIT_HEIGHT = 48;
    function setDeskFitCollapsed(on) {
      const next = !!on;
      if (next === _deskFitCollapsed) return;
      _deskFitCollapsed = next;
      _deskLastFitTarget = 0;
      if (next) document.documentElement.dataset.fitCollapsed = "1";
      else delete document.documentElement.dataset.fitCollapsed;
      _deskChatFrame?.contentWindow?.postMessage({ type: "hub-fit-collapsed", on: next }, "*");
      if (next) {
        const invoke = getTauriInvoke();
        if (typeof invoke === "function") {
          invoke("set_window_height", {
            height: Math.round(DESK_COLLAPSED_FIT_HEIGHT * currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT),
          }).catch((err) => showDeskHubMessage(`set_window_height failed: ${err}`, { error: true }));
        }
        _deskChatFrame?.contentWindow?.focus();
      }
    }
    function toggleDeskFitCollapsed() {
      if (!_deskAutoWindowHeight) return;
      if (_deskFitCollapsed) {
        setDeskFitCollapsed(false);
        _deskChatFrame?.contentWindow?.postMessage({ type: "hub-refit" }, "*");
      } else {
        setDeskFitCollapsed(true);
      }
    }
    function pushDeskAutoWindowHeight() {
      _deskChatFrame?.contentWindow?.postMessage(
        { type: "hub-auto-window-height", on: _deskAutoWindowHeight },
        "*",
      );
    }
    function applyDeskFitHeightMin() {
      const invoke = getTauriInvoke();
      if (typeof invoke === "function") {
        invoke("set_fit_height_min", { enabled: _deskAutoWindowHeight })
          .catch((err) => showDeskHubMessage(`set_fit_height_min failed: ${err}`, { error: true }));
      }
    }
    function setDeskAutoWindowHeight(on) {
      const next = !!on;
      if (next === _deskAutoWindowHeight) return;
      _deskAutoWindowHeight = next;
      _deskLastFitTarget = 0;
      setDeskFitCollapsed(false);
      if (next) document.documentElement.dataset.autoWindowHeight = "1";
      else delete document.documentElement.dataset.autoWindowHeight;
      sessionStorage.setItem(DESK_AUTO_HEIGHT_KEY, next ? "1" : "0");
      if (_deskAutoWindowHeight) setDeskSidebarOpen(false);
      applyDeskFitHeightMin();
      pushDeskAutoWindowHeight();
    }
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
    function fitDeskWindowHeight(contentHeight, { restore = false } = {}) {
      if (!_deskAutoWindowHeight) return;
      if (_deskFitCollapsed) {
        if (!restore) return;
        setDeskFitCollapsed(false);
      }
      const content = Number(contentHeight);
      if (!Number.isFinite(content) || content <= 0) return;
      const invoke = getTauriInvoke();
      if (typeof invoke !== "function" || !_deskChatFrame) return;
      const iframeH = _deskChatFrame.getBoundingClientRect().height;
      const overhead = Math.min(240, Math.max(0, window.innerHeight - iframeH));
      const target = Math.round(content + overhead);
      const snapWidth = _deskFitWidthSnapPending;
      _deskFitWidthSnapPending = false;
      if (!snapWidth && Math.abs(target - _deskLastFitTarget) < 4) return;
      _deskLastFitTarget = target;
      invoke("set_window_height", {
        height: target,
        compactWidthScale: snapWidth ? currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT : null,
      }).catch((err) => {
        showDeskHubMessage(`fit height failed: ${err}`, { error: true });
      });
    }

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
      }
      resetDeskChatView();
    }

    async function moveDeskWindowToSpot(command) {
      const invoke = getTauriInvoke();
      if (typeof invoke !== "function") return;
      try {
        await invoke(command);
      } catch (err) {
        showDeskHubMessage(`${command} failed: ${err}`, { error: true });
      }
    }

    async function resizeDeskWindowAroundPane({ edge, delta, apply, rollback, label }) {
      if (_deskOutwardResizeInFlight || _deskAutoWindowHeight) return;
      const invoke = getTauriInvoke();
      if (typeof invoke !== "function") return;
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

    function deskRightPaneAvailable() {
      return !!_deskChatFrameLoadedUrl && _deskPanelWidth > 0;
    }

    function toggleDeskRightPanelOutward() {
      if (_deskAutoWindowHeight || !deskRightPaneAvailable()) return;
      const width = _deskPanelWidth;
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
        if (event.code === "KeyM") {
          event.preventDefault();
          toggleDeskFitCollapsed();
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
      if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && event.code === "Period") {
        event.preventDefault();
        openDeskChatHeaderMenu();
        return;
      }
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
      if (!event.metaKey || event.ctrlKey) return;
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
            fitCollapsed: _deskFitCollapsed,
            rightPaneAvailable: deskRightPaneAvailable(),
          },
        });
      } catch (_) {
      } finally {
        _deskSettingsBtn.classList.remove("is-active");
      }
    }
