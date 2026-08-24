    const composerFabBtn = document.getElementById("composerFabBtn");
    const composerOverlay = document.getElementById("composerOverlay");
    const composerForm = document.getElementById("composer");
    const isComposerOverlayOpen = () => !!composerOverlay && !composerOverlay.hidden && composerOverlay.classList.contains("visible");
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
    const focusComposerTextarea = ({ sync = false } = {}) => {
      if (!messageInput) return;
      const applyFocus = () => {
        try {
          messageInput.focus({ preventScroll: true });
        } catch (_) {
          messageInput.focus();
        }
        setComposerCaretToEnd();
      };
      if (sync) {
        if (document.documentElement.dataset.mobile === "1" && composerForm) {
          composerForm.classList.add("composer-focus-hack");
          applyFocus();
          let restored = false;
          const restore = () => {
            if (restored) return;
            restored = true;
            composerForm.classList.remove("composer-focus-hack");
            setComposerCaretToEnd();
          };
          requestAnimationFrame(() => requestAnimationFrame(restore));
          setTimeout(restore, 120);
          return;
        }
        applyFocus();
        setTimeout(applyFocus, 0);
        requestAnimationFrame(applyFocus);
        return;
      }
      requestAnimationFrame(() => {
        applyFocus();
        setTimeout(applyFocus, 0);
      });
    };
    const openComposerOverlay = ({ immediateFocus = false } = {}) => {
      if (!composerOverlay) return;
      const canFocus = canComposeInSession();
      if (isComposerOverlayOpen()) {
        if (canFocus) focusComposerTextarea({ sync: immediateFocus });
        return;
      }
      requestHubParentLayout();
      bumpHubIframeLayoutLock();
      composerOverlay.hidden = false;
      composerOverlay.classList.remove("closing");
      document.body.classList.add("composer-overlay-open");
      updateScrollBtn();
      if (immediateFocus && canFocus) {
        focusComposerTextarea({ sync: true });
      }
      requestAnimationFrame(() => {
        if (typeof autoResizeTextarea === "function") autoResizeTextarea();
        setComposerCaretToEnd();
        composerOverlay.classList.add("visible");
        if (!immediateFocus && canFocus) {
          focusComposerTextarea();
        }
      });
    };
    const closeComposerOverlay = ({ restoreFocus = false } = {}) => {
      if (!composerOverlay || composerOverlay.hidden) return;
      document.dispatchEvent(new CustomEvent("composer-overlay-close-start"));
      composerOverlay.classList.remove("visible");
      composerOverlay.classList.add("closing");
      document.body.classList.remove("composer-overlay-open");
      setTimeout(() => {
        if (!composerOverlay.classList.contains("visible")) {
          composerOverlay.hidden = true;
          composerOverlay.classList.remove("closing");
        }
      }, 90);
      updateScrollBtn();
      if (restoreFocus && composerFabBtn && typeof composerFabBtn.focus === "function") {
        try {
          composerFabBtn.focus({ preventScroll: true });
        } catch (_) {
          composerFabBtn.focus();
        }
      }
    };
    scrollToBottomBtn.addEventListener("click", () => {
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
      _stickyToBottom = true;
      scrollConversationToBottom("smooth");
    });
    composerFabBtn?.addEventListener("click", () => {
      openComposerOverlay({ immediateFocus: canComposeInSession() });
    });
    composerOverlay?.addEventListener("click", (event) => {
      if (event.target === composerOverlay) {
        closeComposerOverlay({ restoreFocus: true });
      }
    });
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
    }
