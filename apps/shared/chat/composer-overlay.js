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
        // A selection-handle drag can land outside #message's own box (the
        // handle sits below/beside the glyph it's on), so it isn't caught by
        // the target-based checks below -- an active selection means this
        // touchmove is almost certainly that drag, not a page-scroll attempt.
        if (mobileComposerInput && mobileComposerInput.selectionStart !== mobileComposerInput.selectionEnd) return;
        const target = event.target;
        if (target instanceof Element) {
          if (target.closest("textarea.is-scrollable, .attach-preview-row, .target-picker")) return;
        }
        event.preventDefault();
      }, { passive: false });
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
    // One focus() call, at the one moment the composer is actually laid out
    // and visible (the caller's rAF, or -- if already open -- right now).
    // Mobile keeps its Safari select-on-focus workaround alongside it.
    const focusComposerTextarea = () => {
      if (!messageInput) return;
      const isMobileComposer = document.documentElement.dataset.mobile === "1" && composerForm;
      if (isMobileComposer) composerForm.classList.add("composer-focus-hack");
      try {
        messageInput.focus({ preventScroll: true });
      } catch (_) {
        messageInput.focus();
      }
      setComposerCaretToEnd();
      if (!isMobileComposer) return;
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        composerForm.classList.remove("composer-focus-hack");
        setComposerCaretToEnd();
      };
      requestAnimationFrame(() => requestAnimationFrame(restore));
      setTimeout(restore, 120);
    };
    // immediateFocus: whether this open should also move keyboard focus into
    // the textarea (e.g. false for a drag-to-attach open, which shouldn't
    // steal focus from the drag).
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
      // Mobile's focus hack (position: fixed, opacity: 0) has to run and
      // settle before .visible starts the slide/fade -- doing it after would
      // fight the reveal transition. Desktop has no such constraint, so it
      // focuses at the one already-scheduled post-layout point below.
      const isMobileComposer = document.documentElement.dataset.mobile === "1";
      if (canFocus && isMobileComposer) focusComposerTextarea();
      requestAnimationFrame(() => {
        if (typeof autoResizeTextarea === "function") autoResizeTextarea();
        setComposerCaretToEnd();
        armFitComposerHold();
        composerOverlay.classList.add("visible");
        document.dispatchEvent(new CustomEvent("composer-overlay-open"));
        if (canFocus && !isMobileComposer) focusComposerTextarea();
      });
    };
    // Fit Height: opening asks the hub to grow the window; pin the composer at
    // its start pose until that resize lands so it only rises from the new bottom.
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
      // Top of what's loaded, not the first entry ever -- the transcript is a
      // tail window and older batches auto-load on the way up.
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
    // ⌘↑ / ⌘↓ are the keyboard version of jumping the transcript to its ends.
    // It is an inner scroll container, so the native ⌘↑/⌘↓ never reach it; skip
    // only when a text field wants the caret move it would otherwise do.
    document.addEventListener("keydown", (event) => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const active = document.activeElement;
      if (active && active.matches && active.matches("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      (event.key === "ArrowDown" ? jumpConversationToBottom : jumpConversationToTop)();
    });
    // ⌥↓ / ⌥↑ step to the top of the next / previous message.
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
    // Esc closes the expanded composer. Capture phase so it runs before the
    // @/-menu Esc handlers on the textarea: if one of those menus is open, bail
    // and let it consume the Esc (a second Esc then closes the overlay).
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
      // Enter anywhere in the transcript opens the composer (Esc still closes).
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
