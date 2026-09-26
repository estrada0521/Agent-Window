    const clearPollScrollLock = () => {
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
    };
    let _scrollbarFadeTimer = null;
    const revealScrollbar = () => {
      messagesEl.classList.add("is-scrolling");
      clearTimeout(_scrollbarFadeTimer);
      _scrollbarFadeTimer = setTimeout(() => {
        messagesEl.classList.remove("is-scrolling");
      }, 1000);
    };
    messagesEl.addEventListener("wheel", revealScrollbar, { passive: true });
    messagesEl.addEventListener("touchstart", revealScrollbar, { passive: true });
    messagesEl.addEventListener("scroll", () => {
      if (messagesEl.classList.contains("is-scrolling")) revealScrollbar();
    }, { passive: true });
    messagesEl.addEventListener("wheel", clearPollScrollLock, { passive: true });
    messagesEl.addEventListener("touchstart", clearPollScrollLock, { passive: true });
    messagesEl.addEventListener("scroll", updateStickyState, { passive: true });
    let _olderAutoloadPolling = false;
    const olderAutoloadThreshold = () => Math.max(OLDER_AUTOLOAD_MIN_THRESHOLD, messagesEl.clientHeight * 1.25);
    const olderAutoloadCheck = () => {
      if (olderLoading || !olderHasMore || messagesEl.scrollTop > olderAutoloadThreshold()) return false;
      void loadOlderMessages();
      return true;
    };
    const olderAutoloadTick = () => {
      if (olderAutoloadCheck() || olderLoading || !olderHasMore || messagesEl.scrollTop > olderAutoloadThreshold() * 3) {
        _olderAutoloadPolling = false;
        return;
      }
      requestAnimationFrame(olderAutoloadTick);
    };
    messagesEl.addEventListener("scroll", () => {
      if (olderAutoloadCheck() || _olderAutoloadPolling || olderLoading || !olderHasMore) return;
      _olderAutoloadPolling = true;
      requestAnimationFrame(olderAutoloadTick);
    }, { passive: true });
    const updateScrollBtn = () => {
      if (!hasInitialRefreshHydrated) {
        scrollToBottomBtn.classList.remove("visible");
        composerFabBtn?.classList.remove("visible");
        return;
      }
      const overlayOpen = isComposerOverlayOpen();
      const emptyPlaceholder = !!document.querySelector("#messages .conversation-empty");
      const showComposerFab = emptyPlaceholder || isInComposerFabRange();
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
