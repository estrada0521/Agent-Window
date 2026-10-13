    const clearPollScrollLock = () => {
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
    };
    let olderAutoloadArmed = false;
    let olderAutoloadScrollTop = messagesEl.scrollTop;
    const beginHistoryScroll = () => {
      clearPollScrollLock();
      olderAutoloadArmed = !historyLoading;
      olderAutoloadScrollTop = messagesEl.scrollTop;
    };
    messagesEl.addEventListener("wheel", beginHistoryScroll, { passive: true });
    messagesEl.addEventListener("touchstart", beginHistoryScroll, { passive: true });
    messagesEl.addEventListener("scroll", updateStickyState, { passive: true });
    messagesEl.addEventListener("scroll", () => {
      const top = messagesEl.scrollTop;
      const movingUp = top < olderAutoloadScrollTop;
      olderAutoloadScrollTop = top;
      if (historyWindow?.has_newer && !historyLoading && !_programmaticScroll && isNearBottom()) {
        void loadHistoryPage(false);
      }
      if (historyLoading || _programmaticScroll || !hasOlderMessages()) return;
      if (document.documentElement.dataset.mobile === "1" && (!olderAutoloadArmed || !movingUp)) return;
      if (top > Math.max(OLDER_AUTOLOAD_MIN_THRESHOLD, messagesEl.clientHeight * (document.documentElement.dataset.mobile === "1" ? 1.5 : 2.5))) return;
      olderAutoloadArmed = false;
      void loadOlderMessages();
    }, { passive: true });
    const updateScrollBtn = () => {
      if (!hasInitialRefreshHydrated) {
        scrollToBottomBtn.classList.remove("visible");
        composerFabBtn?.classList.remove("visible");
        return;
      }
      const overlayOpen = isComposerOverlayOpen();
      const emptyPlaceholder = !!document.querySelector("#messages .conversation-empty");
      const showComposerFab = !historyWindow && (emptyPlaceholder || isNearBottom());
      scrollToBottomBtn.classList.toggle("visible", !showComposerFab && !overlayOpen);
      composerFabBtn?.classList.toggle("visible", showComposerFab && !overlayOpen);
    };
    let centeredRowRaf = 0;
    const updateCenteredMessageRow = () => {
      const rows = Array.from(document.querySelectorAll("#messages article.message-row"));
      rows.forEach((row) => row.classList.remove("is-centered"));
      const useCenterHighlight = window.matchMedia("(hover: none), (pointer: coarse)").matches;
      if (!useCenterHighlight || !rows.length) return;
      const timelineRect = messagesEl.getBoundingClientRect();
      const centerY = timelineRect.top + (timelineRect.height / 2);
      let bestRow = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      rows.forEach((row) => {
        const rect = row.getBoundingClientRect();
        if (rect.bottom <= timelineRect.top || rect.top >= timelineRect.bottom) return;
        const rowCenter = rect.top + (rect.height / 2);
        const distance = Math.abs(rowCenter - centerY);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestRow = row;
        }
      });
      bestRow?.classList.add("is-centered");
    };
    const requestCenteredMessageRowUpdate = () => {
      if (centeredRowRaf) return;
      centeredRowRaf = requestAnimationFrame(() => {
        centeredRowRaf = 0;
        updateCenteredMessageRow();
      });
    };
    const flashHeaderToggle = (node) => {
      if (!node || node.classList.contains("animating")) return;
      node.classList.add("animating");
      setTimeout(() => {
        node.classList.remove("animating");
      }, 500);
    };
    document.addEventListener("pointerdown", (e) => {
      const toggle = e.target.closest(".page-menu-btn, .composer-attach-btn");
      if (toggle) {
        if (toggle.classList.contains("animating")) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        flashHeaderToggle(toggle);
      }
    });
    messagesEl.addEventListener("scroll", updateScrollBtn, { passive: true });
    messagesEl.addEventListener("scroll", requestCenteredMessageRowUpdate, { passive: true });
    window.addEventListener("resize", requestCenteredMessageRowUpdate);
