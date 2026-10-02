    const composerFabBtn = document.getElementById("composerFabBtn");
    const composerOverlay = document.getElementById("composerOverlay");
    const composerForm = document.getElementById("composer");
    const composerDockBtn = document.getElementById("composerDockBtn");
    const isComposerOverlayOpen = () => !!composerOverlay && !composerOverlay.hidden && composerOverlay.classList.contains("visible");
    const setComposerDocked = (on) => {
      composerOverlay.classList.toggle("docked", on);
      const label = on ? "Center composer" : "Move composer to bottom";
      composerDockBtn.setAttribute("aria-label", label);
      composerDockBtn.title = `${label} [${on ? "⌃⌘↑" : "⌃⌘↓"}]`;
      composerDockBtn.setAttribute("aria-pressed", on ? "true" : "false");
      if (typeof autoResizeTextarea === "function") autoResizeTextarea();
    };
    if (document.documentElement.dataset.mobile === "1" && document.documentElement.dataset.hubIframeTimeline === "1") {
      const mobileComposerInput = document.getElementById("message");
      composerOverlay?.addEventListener("touchstart", (event) => {
        if (event.target !== composerOverlay) return;
        event.preventDefault();
        if (composing && document.activeElement === mobileComposerInput) return;
        closeComposerOverlay();
      }, { passive: false });
      composerOverlay?.addEventListener("touchmove", (event) => {
        if (mobileComposerInput && mobileComposerInput.selectionStart !== mobileComposerInput.selectionEnd) return;
        const target = event.target;
        if (target instanceof Element) {
          if (target.closest("textarea.is-scrollable, .attach-preview-row, .target-picker")) return;
        }
        event.preventDefault();
      }, { passive: false });
      const lockComposerMenuPan = (menu) => {
        menu?.addEventListener("touchmove", (event) => {
          if (menu.classList.contains("is-scrollable")) return;
          event.preventDefault();
        }, { passive: false });
      };
      lockComposerMenuPan(document.getElementById("fileDropdown"));
      lockComposerMenuPan(document.getElementById("cmdDropdown"));
      mobileComposerInput?.addEventListener("touchstart", (event) => {
        if (document.activeElement !== mobileComposerInput) return;
        const parentChromeGap = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--hub-parent-chrome-gap"),
        );
        if (!Number.isFinite(parentChromeGap) || parentChromeGap >= HUB_KEYBOARD_GAP_THRESHOLD) return;
        event.preventDefault();
        mobileComposerInput.blur();
        mobileComposerInput.focus({ preventScroll: true });
      }, { passive: false });
    }
    const setComposerCaretToEnd = () => {
      if (!messageInput) return;
      const end = messageInput.value.length;
      if (typeof messageInput.setSelectionRange === "function") {
        try {
          messageInput.setSelectionRange(end, end);
        } catch (_) {}
      }
      messageInput.scrollTop = messageInput.scrollHeight;
    };
    const focusComposerTextarea = (onReady = null) => {
      if (!messageInput) return;
      const isMobileComposer = document.documentElement.dataset.mobile === "1" && composerForm;
      if (isMobileComposer) composerForm.classList.add("composer-focus-hack");
      try {
        messageInput.focus({ preventScroll: true });
      } catch (_) {
        messageInput.focus();
      }
      setComposerCaretToEnd();
      if (!isMobileComposer) {
        if (onReady) onReady();
        return;
      }
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        composerForm.classList.remove("composer-focus-hack");
        setComposerCaretToEnd();
        if (onReady) onReady();
      };
      requestAnimationFrame(() => requestAnimationFrame(restore));
      setTimeout(restore, 120);
    };
    const openComposerOverlay = ({ immediateFocus = false } = {}) => {
      if (!composerOverlay) return;
      const canFocus = immediateFocus && canCompose();
      if (isComposerOverlayOpen()) {
        if (canFocus) focusComposerTextarea();
        return;
      }
      requestHubParentLayout();
      if (document.documentElement.dataset.mobile === "1") bumpHubIframeLayoutLock();
      composerOverlay.hidden = false;
      document.body.classList.add("composer-overlay-open");
      updateScrollBtn();
      if (typeof updateSendBtnVisibility === "function") updateSendBtnVisibility();
      const isMobileComposer = document.documentElement.dataset.mobile === "1";
      const reveal = () => {
        composerForm?.classList.remove("composer-opening-ready");
        if (typeof autoResizeTextarea === "function") autoResizeTextarea();
        setComposerCaretToEnd();
        armFitComposerHold();
        composerOverlay.classList.add("visible");
        document.dispatchEvent(new CustomEvent("composer-overlay-open"));
        if (canFocus && !isMobileComposer) focusComposerTextarea();
      };
      if (canFocus && isMobileComposer) {
        focusComposerTextarea(() => {
          composerForm.classList.add("composer-opening-ready");
          requestAnimationFrame(reveal);
        });
      } else {
        requestAnimationFrame(reveal);
      }
    };
    const armFitComposerHold = () => {
      if (!composerOverlay || document.documentElement.dataset.autoWindowHeight !== "1") return;
      composerOverlay.classList.add("fit-arming");
      let done = false;
      const disarm = () => {
        if (done) return;
        done = true;
        window.removeEventListener("resize", disarm);
        clearTimeout(fallback);
        requestAnimationFrame(() => composerOverlay.classList.remove("fit-arming"));
      };
      const fallback = setTimeout(disarm, 200);
      window.addEventListener("resize", disarm);
    };
    const closeComposerOverlay = ({ restoreFocus = false } = {}) => {
      if (!composerOverlay || composerOverlay.hidden) return;
      const isMobileComposer = document.documentElement.dataset.mobile === "1";
      if (isMobileComposer && document.activeElement === messageInput) {
        messageInput.blur();
      }
      document.dispatchEvent(new CustomEvent("composer-overlay-close-start"));
      composerForm?.classList.remove("composer-opening-ready");
      composerOverlay.classList.remove("visible", "fit-arming");
      if (composerOverlay.classList.contains("docked")) setComposerDocked(false);
      document.body.classList.remove("composer-overlay-open");
      composerOverlay.hidden = true;
      updateScrollBtn();
      if (!isMobileComposer && restoreFocus && composerFabBtn && typeof composerFabBtn.focus === "function") {
        try {
          composerFabBtn.focus({ preventScroll: true });
        } catch (_) {
          composerFabBtn.focus();
        }
      }
    };
    composerFabBtn?.addEventListener("click", () => {
      openComposerOverlay({ immediateFocus: canCompose() });
    });
    if (document.documentElement.dataset.mobile !== "1") {
      composerDockBtn?.addEventListener("click", () => {
        if (!isComposerOverlayOpen() || document.documentElement.dataset.autoWindowHeight === "1") return;
        composerDockBtn.classList.add("suppress-hover");
        window.addEventListener("pointermove", () => composerDockBtn.classList.remove("suppress-hover"), { once: true });
        setComposerDocked(!composerOverlay.classList.contains("docked"));
        messageInput.focus({ preventScroll: true });
      });
      document.addEventListener("keydown", (event) => {
        if (!event.metaKey || !event.ctrlKey || event.altKey || event.shiftKey) return;
        if (event.code !== "ArrowDown" && event.code !== "ArrowUp") return;
        if (event.isComposing || !isComposerOverlayOpen() || document.documentElement.dataset.autoWindowHeight === "1") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        const isDocked = composerOverlay.classList.contains("docked");
        if (event.code === "ArrowDown" && !isDocked) {
          setComposerDocked(true);
        } else if (event.code === "ArrowUp" && isDocked) {
          setComposerDocked(false);
        }
      }, true);
    }
    composerOverlay?.addEventListener("click", (event) => {
      if (event.target === composerOverlay) {
        closeComposerOverlay({ restoreFocus: true });
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      if (!isComposerOverlayOpen()) return;
      const fileDrop = document.getElementById("fileDropdown");
      const cmdDrop = document.getElementById("cmdDropdown");
      if (fileDrop?.classList.contains("visible") || cmdDrop?.classList.contains("visible")) return;
      event.preventDefault();
      event.stopPropagation();
      closeComposerOverlay({ restoreFocus: true });
    }, true);
    if (document.documentElement.dataset.mobile !== "1") {
      const shouldIgnoreComposerMouseShortcut = (target) => !!target?.closest?.("a, button, input, textarea, select, summary, label, [contenteditable='true'], #fileDropdown, #cmdDropdown");
      document.addEventListener("mousedown", (event) => {
        if (event.button !== 1) return;
        if (shouldIgnoreComposerMouseShortcut(event.target)) return;
        event.preventDefault();
        openComposerOverlay({ immediateFocus: canCompose() });
      }, { capture: true });
      document.addEventListener("auxclick", (event) => {
        if (event.button !== 1) return;
        if (shouldIgnoreComposerMouseShortcut(event.target)) return;
        event.preventDefault();
      }, { capture: true });
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        if (event.isComposing || event.keyCode === 229) return;
        if (isComposerOverlayOpen() || !canCompose()) return;
        const active = document.activeElement;
        if (active && active.matches && active.matches("input, textarea, select, button, a, summary, [contenteditable='true']")) return;
        event.preventDefault();
        openComposerOverlay({ immediateFocus: true });
      });
    }
