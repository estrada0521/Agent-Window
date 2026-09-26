__INCLUDE:../base.js__
    document.documentElement.dataset.mobile = "1";
    const _safariSafeAreaDummy = document.createElement("div");
    _safariSafeAreaDummy.style.cssText = "position:absolute;bottom:0;width:100%;height:env(safe-area-inset-bottom);pointer-events:none;opacity:0;z-index:-1;";
    document.body.appendChild(_safariSafeAreaDummy);
    const blockHistoryEdgeSwipe = (surface) => {
      if (!surface?.addEventListener) return;
      surface.addEventListener("touchstart", (event) => {
        const touch = event.touches?.[0];
        if (!touch) return;
        const view = surface.defaultView || surface.ownerDocument?.defaultView || window;
        const width = view.innerWidth || 0;
        if (touch.clientX < 24 || touch.clientX > width - 24) event.preventDefault();
      }, { capture: true, passive: false });
    };
    blockHistoryEdgeSwipe(document);
    const applyMobileThemeGradientVars = () => {
      const root = document.documentElement;
      const sheetChannels = getComputedStyle(root).getPropertyValue("--bg-rgb").trim();
      const topChannels = root.dataset.theme === "light" ? "255, 255, 255" : "0, 0, 0";
      root.style.setProperty("--mobile-top-gradient-rgb", topChannels);
      root.style.setProperty("--mobile-sheet-gradient-rgb", sheetChannels);
    };
    applyMobileThemeGradientVars();
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "data-theme")) {
        applyMobileThemeGradientVars();
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const _hubBackLink = document.querySelector(".page-title");
    if (_hubBackLink) {
      let _hubSwipeStartX = 0;
      let _hubSwipeStartY = 0;
      let _hubSwipeTracking = false;
      let _hubSwipeReady = false;
      let _menuSwipeReady = false;
      const _resetHubSwipe = () => {
        _hubSwipeTracking = false;
        _hubSwipeReady = false;
        _menuSwipeReady = false;
      };
      document.addEventListener("touchstart", (event) => {
        if (document.getElementById("composerOverlay")?.classList.contains("visible")) return;
        if (document.querySelector(".mobile-sheet-overlay.open")) return;
        if (event.target.closest?.(".table-scroll, .katex-display, pre")) return;
        const touch = event.touches?.[0];
        if (!touch) return;
        _hubSwipeStartX = touch.clientX;
        _hubSwipeStartY = touch.clientY;
        _hubSwipeTracking = true;
        _hubSwipeReady = false;
        _menuSwipeReady = false;
      }, { passive: true });
      document.addEventListener("touchmove", (event) => {
        if (!_hubSwipeTracking) return;
        const touch = event.touches?.[0];
        if (!touch) {
          _resetHubSwipe();
          return;
        }
        const deltaX = touch.clientX - _hubSwipeStartX;
        const deltaY = touch.clientY - _hubSwipeStartY;
        if (Math.abs(deltaY) > 42) {
          _resetHubSwipe();
          return;
        }
        if (deltaX > 56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
          _hubSwipeReady = true;
          _menuSwipeReady = false;
        } else if (deltaX < -56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
          _hubSwipeReady = false;
          _menuSwipeReady = true;
        }
      }, { passive: true });
      document.addEventListener("touchend", () => {
        if (!_hubSwipeTracking) return;
        const shouldOpenHub = _hubSwipeReady;
        const shouldOpenMenu = _menuSwipeReady;
        _resetHubSwipe();
        if (shouldOpenHub) _hubBackLink.click();
        else if (shouldOpenMenu) document.getElementById("pageMenuBtn")?.click();
      }, { passive: true });
      document.addEventListener("touchcancel", _resetHubSwipe, { passive: true });
    }
__INCLUDE:../conversation-state.js__
    const timeline = document.getElementById("messages");
    const syncMainAfterHeight = () => {
      const mainEl = document.querySelector("main");
      if (!mainEl) return;
      const lockHeight = parseInt(document.documentElement.style.getPropertyValue("--hub-iframe-lock-height"), 10) || 0;
      const baseHeight = lockHeight > 0
        ? lockHeight
        : Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
      if (baseHeight <= 0) return;
      const fixedSpacerHeight = Math.round(baseHeight * 0.5);
      mainEl.style.setProperty("--main-spacer-height", fixedSpacerHeight + "px");
      mainEl.style.removeProperty("--main-after-height");
    };
    let _pollScrollLockTop = null;
    let _pollScrollAnchor = null;
    syncMainAfterHeight();
    window.addEventListener("resize", syncMainAfterHeight, { passive: true });
    if (window.visualViewport) {
      const onVVResize = () => {
        syncMainAfterHeight();
        updateScrollBtnPos();
        if (_stickyToBottom && timeline) {
          _pollScrollLockTop = null;
          _pollScrollAnchor = null;
          timeline.scrollTop = timeline.scrollHeight;
        }
        if (typeof repositionOpenComposerMenu === "function") repositionOpenComposerMenu();
        if (typeof positionComposerDropdown === "function" && attachPreviewRow?.children.length) {
          positionComposerDropdown(attachPreviewRow);
        }
      };
      visualViewport.addEventListener("resize", onVVResize);
      visualViewport.addEventListener("scroll", onVVResize);
    }
    let _hubIframeLayoutMaxH = 0;
    let _hubIframeLayoutFromParent = 0;
    let _hubChromeGapClientMin = Infinity;
    const HUB_KEYBOARD_GAP_THRESHOLD = 150;
    let _hubChildOriW = 0;
    let _hubChildOriH = 0;
    const isEmbeddedHubChat = window.parent !== window;
    const applyHubIframeLockHeight = () => {
      if (!isEmbeddedHubChat) {
        syncMainAfterHeight();
        return;
      }
      const local = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
      _hubIframeLayoutMaxH = Math.max(_hubIframeLayoutMaxH, local);
      const h = Math.max(_hubIframeLayoutMaxH, _hubIframeLayoutFromParent);
      if (h > 0) {
        document.documentElement.style.setProperty("--hub-iframe-lock-height", h + "px");
      }
      syncMainAfterHeight();
    };
    const bumpHubIframeLayoutLock = () => {
      if (!isEmbeddedHubChat) return;
      applyHubIframeLockHeight();
    };
    const requestHubParentLayout = () => {
      if (!isEmbeddedHubChat) return;
      window.parent.postMessage({ type: "chat-request-hub-layout" }, "*");
    };
    const requestHubCloseChat = () => {
      if (!isEmbeddedHubChat) return;
      window.parent.postMessage("hub_close_chat", "*");
    };
    const notifyHubChatRenderReady = () => {
      if (!isEmbeddedHubChat) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.parent.postMessage({ type: "chat-render-ready" }, "*");
        });
      });
    };
    const notifyHubChatRenderError = () => {
      if (!isEmbeddedHubChat) return;
      window.parent.postMessage({ type: "chat-render-error" }, "*");
    };
    if (isEmbeddedHubChat) {
      document.documentElement.dataset.hubIframeChat = "1";
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
          if (incoming < HUB_KEYBOARD_GAP_THRESHOLD) {
            _hubChromeGapClientMin = Math.min(_hubChromeGapClientMin, incoming);
          }
          const effective = incoming >= HUB_KEYBOARD_GAP_THRESHOLD ? incoming : _hubChromeGapClientMin;
          document.documentElement.style.setProperty(
            "--hub-parent-chrome-gap",
            (effective === Infinity ? incoming : effective) + "px",
          );
        }
      });
      __INCLUDE:../hub-safari-chrome.js__
      bumpHubIframeLayoutLock();
      hubPingParentForSafariChrome();
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
    window.addEventListener("message", (e) => {
      if (!e.data || e.data.type !== "hub-theme-changed") return;
      document.documentElement.dataset.theme = e.data.theme === "light" ? "light" : "dark";
      if (["system", "light", "dark"].includes(e.data.themeMobile)) {
        document.documentElement.dataset.themeMobile = e.data.themeMobile;
      }
    });
    if (window.parent !== window) {
      const reportObservedSystemTheme = () => {
        if (document.documentElement.dataset.themeMobile !== "system") return;
        window.parent.postMessage({
          type: "hub-mobile-system-theme-observed",
          theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        }, "*");
      };
      try {
        const query = window.matchMedia("(prefers-color-scheme: dark)");
        if (query.addEventListener) query.addEventListener("change", reportObservedSystemTheme);
        else if (query.addListener) query.addListener(reportObservedSystemTheme);
      } catch (_) {}
      window.addEventListener("pageshow", reportObservedSystemTheme);
      window.addEventListener("focus", reportObservedSystemTheme);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) reportObservedSystemTheme();
      });
    }
__INCLUDE:../scroll-focus.js__
__INCLUDE:file-modal.js__
__INCLUDE:../composer-overlay.js__
__INCLUDE:../rich-rendering-setup.js__
__INCLUDE:../transcript-rich-rendering.js__
__INCLUDE:../message-collapse.js__
__INCLUDE:../target-picker.js__
    {
      const picker = document.getElementById("targetPicker");
      let anchor = null;
      const positionPicker = () => {
        if (!anchor || !document.body.classList.contains("composer-overlay-open")) return;
        const rect = anchor.getBoundingClientRect();
        if (rect.width <= 0) return;
        const transform = getComputedStyle(composerForm).transform;
        const composerOffsetY = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
        picker.style.left = `${rect.left}px`;
        picker.style.top = `${rect.top - composerOffsetY}px`;
        picker.style.width = `${rect.width}px`;
        picker.style.height = `${rect.height}px`;
        syncTargetPickerFade();
      };
      const ensureAnchor = () => {
        if (anchor) return;
        anchor = document.createElement("div");
        anchor.className = "target-picker-anchor";
        picker.replaceWith(anchor);
        document.body.appendChild(picker);
        if (typeof ResizeObserver === "function") new ResizeObserver(positionPicker).observe(anchor);
      };
      document.addEventListener("composer-overlay-open", () => {
        const revealPicker = () => {
          ensureAnchor();
          positionPicker();
          document.body.classList.add("composer-target-picker-visible");
        };
        if (composerForm?.classList.contains("composer-focus-hack")) requestAnimationFrame(revealPicker);
        else revealPicker();
      });
      document.addEventListener("composer-overlay-close-start", () => {
        document.body.classList.remove("composer-target-picker-visible");
      });
      window.addEventListener("resize", positionPicker, { passive: true });
      window.visualViewport?.addEventListener("resize", positionPicker, { passive: true });
      window.visualViewport?.addEventListener("scroll", positionPicker, { passive: true });
    }
__INCLUDE:../target-selection.js__
__INCLUDE:../composer-draft.js__
__INCLUDE:../scroll-lock.js__
    const updateStickyState = () => {
      if (_programmaticScroll) return;
      _stickyToBottom = isNearBottom();
      refreshViewportCenterAnchor();
    };
__INCLUDE:../scroll-btn.js__

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
__INCLUDE:hub-navigation.js__
    const rightMenuBtn = document.getElementById("pageMenuBtn");

__INCLUDE:sheets.js__
__INCLUDE:../composer-runtime.js__
__INCLUDE:../file-runtime.js__
__INCLUDE:../composer-commands.js__
__INCLUDE:../thinking.js__
__INCLUDE:../agent-status.js__
__INCLUDE:../pointer-capability.js__
__INCLUDE:pane-viewer.js__
__INCLUDE:message-row-press.js__
    const openMobileSheetKind = () => (
      mobileSheet && mobileSheet.classList.contains("open") && !mobileSheet.hidden
        ? String(mobileSheet.dataset.kind || "")
        : ""
    );
    const handleWorkspaceFilesChanged = () => {
      if (openMobileSheetKind() === "repo" && typeof mobileSheet._syncCategoryUi === "function") {
        mobileSheet._syncCategoryUi();
      }
    };
    const handleWorkspaceGitChanged = () => {
      if (openMobileSheetKind() === "git") {
        void updateGitPanel().catch(() => {});
      }
    };
    __INCLUDE:../chat-events.js__
    refresh({ forceScroll: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        void refresh();
      }
    });
