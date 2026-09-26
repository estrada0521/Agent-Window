    let _deskAlwaysOnTop = false;
    function applyDeskAlwaysOnTop(on) {
      _deskAlwaysOnTop = !!on;
      if (_deskAlwaysOnTop) document.documentElement.dataset.alwaysOnTop = "1";
      else delete document.documentElement.dataset.alwaysOnTop;
      const invoke = getNativeInvoke();
      if (typeof invoke === "function") {
        invoke("set_always_on_top", { on: _deskAlwaysOnTop }).catch((err) => {
          setStatus(`always on top failed: ${err}`);
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
      _deskRoomFrame?.contentWindow?.postMessage({ type: "hub-fit-collapsed", on: next }, "*");
      if (next) {
        const invoke = getNativeInvoke();
        if (typeof invoke === "function") {
          invoke("set_window_height", {
            height: Math.round(DESK_COLLAPSED_FIT_HEIGHT * currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT),
          }).catch((err) => setStatus(`set_window_height failed: ${err}`));
        }
        _deskRoomFrame?.contentWindow?.focus();
      }
    }
    function toggleDeskFitCollapsed() {
      if (!_deskAutoWindowHeight) return;
      if (_deskFitCollapsed) {
        setDeskFitCollapsed(false);
        _deskRoomFrame?.contentWindow?.postMessage({ type: "hub-refit" }, "*");
      } else {
        setDeskFitCollapsed(true);
      }
    }
    function pushDeskAutoWindowHeight() {
      _deskRoomFrame?.contentWindow?.postMessage(
        { type: "hub-auto-window-height", on: _deskAutoWindowHeight },
        "*",
      );
    }
    function applyDeskFitHeightMin() {
      const invoke = getNativeInvoke();
      if (typeof invoke === "function") {
        invoke("set_fit_height_min", { enabled: _deskAutoWindowHeight })
          .catch((err) => setStatus(`set_fit_height_min failed: ${err}`));
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
        const invoke = getNativeInvoke();
        if (typeof invoke === "function") {
          invoke("set_window_height", { height: DESK_DEFAULT_WINDOW_HEIGHT * currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT }).catch((err) => {
            setStatus(`fit height exit resize failed: ${err}`);
          });
        }
        return;
      }
      resetDeskRoomView();
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
      const invoke = getNativeInvoke();
      if (typeof invoke !== "function" || !_deskRoomFrame) return;
      const iframeH = _deskRoomFrame.getBoundingClientRect().height;
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
        setStatus(`fit height failed: ${err}`);
      });
    }

    async function resetDeskWindowState() {
      showDeskSidebarList({ open: true });
      setDeskSidebarWidthAtDefaultTextSize(DESK_DEFAULT_SIDEBAR_WIDTH_AT_DEFAULT_TEXT_SIZE);
      setDeskAutoWindowHeight(false);
      applyDeskAlwaysOnTop(false);
      const invoke = getNativeInvoke();
      if (typeof invoke === "function") {
        try {
          await invoke("reset_window_geometry", { scale: currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT });
        } catch (err) {
          setStatus(`reset window failed: ${err}`);
        }
      }
      resetDeskRoomView();
    }

    async function compactDeskWindowState(command = "compact_window_geometry", label = "compact window") {
      setDeskSidebarOpen(false);
      setDeskAutoWindowHeight(false);
      applyDeskAlwaysOnTop(false);
      const invoke = getNativeInvoke();
      if (typeof invoke === "function") {
        try {
          await invoke(command, { scale: currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT });
        } catch (err) {
          setStatus(`${label} failed: ${err}`);
        }
      }
      resetDeskRoomView();
    }

    async function moveDeskWindowToSpot(command) {
      const invoke = getNativeInvoke();
      if (typeof invoke !== "function") return;
      try {
        await invoke(command);
      } catch (err) {
        setStatus(`${command} failed: ${err}`);
      }
    }

    async function resizeDeskWindowAroundPane({ edge, delta, apply, rollback, label, applyAfterResize = false }) {
      if (_deskOutwardResizeInFlight || _deskAutoWindowHeight) return;
      const invoke = getNativeInvoke();
      if (typeof invoke !== "function") return;
      _deskOutwardResizeInFlight = true;
      let applied = false;
      try {
        const resizing = invoke("resize_window_from_edge", { edge, delta });
        if (applyAfterResize) await resizing;
        apply();
        applied = true;
        if (!applyAfterResize) await resizing;
      } catch (err) {
        if (applied) rollback();
        setStatus(`${label} failed: ${err}`);
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
      return !!_deskRoomFrameLoadedUrl && _deskPanelWidth > 0;
    }

    function toggleDeskRightPanelOutward() {
      if (_deskAutoWindowHeight || !deskRightPaneAvailable()) return;
      const width = _deskPanelWidth;
      const opening = !_deskPanelActiveMode;
      void resizeDeskWindowAroundPane({
        edge: "right",
        delta: opening ? width : -width,
        applyAfterResize: !opening,
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
        if (event.code === "KeyL") {
          event.preventDefault();
          dispatchDeskNativeMenuAction({ action: "revealLog" });
          return;
        }
        if (event.code === "KeyO" && isNativeApp()) {
          event.preventDefault();
          if (event.shiftKey) openDeskHubInBrowser();
          else sendDeskRoomAction("openInBrowser");
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
        openDeskRoomHeaderMenu();
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
        else sendDeskRoomAction("reloadRoom");
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
        postDeskRoomFrameMessage({ type: "toggle-git-pin" });
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

    function openDeskHubInBrowser() {
      getNativeInvoke()?.("open_external_url", { url: `${window.location.origin}/` })
        .catch((err) => setStatus(`open in browser failed: ${err}`));
    }

    function openBrowserAppearanceMenu() {
      const run = (detail) => window.dispatchEvent(new CustomEvent("native-menu-action", { detail }));
      const current = document.documentElement.dataset.themeDesktop || "dark";
      const submenus = {
        theme: ["system", "light", "dark"].map((theme) => ({
          value: theme,
          label: `${theme === current ? "✓ " : ""}${theme[0].toUpperCase()}${theme.slice(1)}`,
          detail: { action: "theme", theme },
        })),
        sidePanels: [
          { value: "toggleHubSidebar", label: "Toggle Hub Sidebar" },
          { value: "toggleRightPane", label: "Toggle Right Pane", disabled: !deskRightPaneAvailable() },
        ],
        messages: [
          { value: "messagePrevious", label: "Previous Message" },
          { value: "messageNext", label: "Next Message" },
          { value: "messageJumpTop", label: "Jump to Top" },
          { value: "messageJumpBottom", label: "Jump to Bottom" },
        ],
      };
      const titles = { theme: "Theme", sidePanels: "Side Panels", messages: "Messages" };
      openMenuSelect(_deskSettingsBtn, "Settings", [
        { value: "theme", label: "Theme" },
        { value: "actual", label: "Actual Size", disabled: currentDeskTextSizePx() === DESK_TEXT_SIZE_DEFAULT },
        { value: "increase", label: "Zoom In" },
        { value: "decrease", label: "Zoom Out" },
        { value: "sidePanels", label: "Side Panels" },
        { value: "messages", label: "Messages" },
      ], (value) => {
        if (!submenus[value]) {
          run({ action: "textSize", mode: value });
          return;
        }
        openMenuSelect(_deskSettingsBtn, titles[value], submenus[value], (picked) => {
          const item = submenus[value].find((entry) => entry.value === picked);
          run(item.detail || { action: picked });
        });
      });
    }

    async function openAppearanceMenu() {
      const invoke = getNativeInvoke();
      if (typeof invoke !== "function") {
        openBrowserAppearanceMenu();
        return;
      }
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
