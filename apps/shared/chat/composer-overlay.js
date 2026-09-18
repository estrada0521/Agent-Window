    const composerFabBtn = document.getElementById("composerFabBtn");
    const composerOverlay = document.getElementById("composerOverlay");
    const composerForm = document.getElementById("composer");
    const isComposerOverlayOpen = () => !!composerOverlay && !composerOverlay.hidden && composerOverlay.classList.contains("visible");
    if (document.documentElement.dataset.mobile === "1" && document.documentElement.dataset.hubIframeChat === "1") {
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
      const canFocus = immediateFocus && canComposeInSession();
      if (isComposerOverlayOpen()) {
        if (canFocus) focusComposerTextarea();
        return;
      }
      requestHubParentLayout();
      bumpHubIframeLayoutLock();
      composerOverlay.hidden = false;
      composerOverlay.classList.remove("closing");
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
      document.body.classList.remove("composer-overlay-open");
      if (isMobileComposer) {
        composerOverlay.classList.add("closing");
        setTimeout(() => {
          if (!composerOverlay.classList.contains("visible")) {
            composerOverlay.hidden = true;
            composerOverlay.classList.remove("closing");
          }
        }, 90);
      } else {
        composerOverlay.classList.remove("closing");
        composerOverlay.hidden = true;
      }
      updateScrollBtn();
      if (!isMobileComposer && restoreFocus && composerFabBtn && typeof composerFabBtn.focus === "function") {
        try {
          composerFabBtn.focus({ preventScroll: true });
        } catch (_) {
          composerFabBtn.focus();
        }
      }
    };
    const messageStepTopGap = () => {
      const style = getComputedStyle(timeline);
      const value = parseFloat(document.documentElement.dataset.mobile !== "1" && document.documentElement.dataset.autoWindowHeight === "1"
        ? style.scrollPaddingTop : style.getPropertyValue("--message-step-top-gap"));
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    };
    const positionConversationRowAtStepTop = (row, behavior) => {
      const timelineTop = timeline.getBoundingClientRect().top;
      const top = timeline.scrollTop + row.getBoundingClientRect().top - timelineTop - messageStepTopGap();
      timeline.scrollTo({ top, behavior });
    };
    const jumpConversationToBottom = () => {
      if (document.documentElement.dataset.autoWindowHeight === "1" && typeof fitStepToLatest === "function") {
        fitStepToLatest();
        return;
      }
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
      _stickyToBottom = true;
      scrollConversationToBottom("smooth");
    };
    const jumpConversationToTop = () => {
      if (document.documentElement.dataset.autoWindowHeight === "1" && typeof fitStepToFirst === "function") {
        fitStepToFirst();
        return;
      }
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
      _stickyToBottom = false;
      _programmaticScroll = true;
      timeline.scrollTo({ top: 0, behavior: "smooth" });
      requestAnimationFrame(() => { _programmaticScroll = false; });
    };
    scrollToBottomBtn.addEventListener("click", jumpConversationToBottom);
    document.addEventListener("keydown", (event) => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const active = document.activeElement;
      if (active && active.matches && active.matches("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      (event.key === "ArrowDown" ? jumpConversationToBottom : jumpConversationToTop)();
    });
    const stepConversationByMessage = (down) => {
      if (document.documentElement.dataset.autoWindowHeight === "1") {
        if (typeof fitStepToMessage === "function") fitStepToMessage(down);
        return;
      }
      const rows = timeline.querySelectorAll("article.message-row");
      if (!rows.length) return;
      const tTop = timeline.getBoundingClientRect().top;
      const stepTop = tTop + messageStepTopGap();
      let target = null;
      if (down) {
        for (const row of rows) {
          if (row.getBoundingClientRect().top - stepTop > 2) { target = row; break; }
        }
      } else {
        for (const row of rows) {
          if (row.getBoundingClientRect().top - stepTop < -2) target = row; else break;
        }
      }
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
      if (!down) _stickyToBottom = false;
      _programmaticScroll = true;
      if (target) positionConversationRowAtStepTop(target, "smooth");
      else timeline.scrollTo({ top: down ? timeline.scrollHeight : 0, behavior: "smooth" });
      requestAnimationFrame(() => { _programmaticScroll = false; });
    };
    document.addEventListener("keydown", (event) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const active = document.activeElement;
      if (active && active.matches && active.matches("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      stepConversationByMessage(event.key === "ArrowDown");
    });
    composerFabBtn?.addEventListener("click", () => {
      openComposerOverlay({ immediateFocus: canComposeInSession() });
    });
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
        openComposerOverlay({ immediateFocus: canComposeInSession() });
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
        if (isComposerOverlayOpen() || !canComposeInSession()) return;
        const active = document.activeElement;
        if (active && active.matches && active.matches("input, textarea, select, button, a, summary, [contenteditable='true']")) return;
        event.preventDefault();
        openComposerOverlay({ immediateFocus: true });
      });
    }
