    const clearPollScrollLock = () => {
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
    };
    timeline.addEventListener("wheel", clearPollScrollLock, { passive: true });
    timeline.addEventListener("touchstart", clearPollScrollLock, { passive: true });
    timeline.addEventListener("scroll", updateStickyState, { passive: true });
    let _olderAutoloadPolling = false;
    const olderAutoloadThreshold = () => Math.max(OLDER_AUTOLOAD_MIN_THRESHOLD, timeline.clientHeight * 1.25);
    const olderAutoloadCheck = () => {
      if (olderLoading || !olderHasMore || timeline.scrollTop > olderAutoloadThreshold()) return false;
      void loadOlderMessages();
      return true;
    };
    const olderAutoloadTick = () => {
      if (olderAutoloadCheck() || olderLoading || !olderHasMore || timeline.scrollTop > olderAutoloadThreshold() * 3) {
        _olderAutoloadPolling = false;
        return;
      }
      requestAnimationFrame(olderAutoloadTick);
    };
    timeline.addEventListener("scroll", () => {
      // A scroll event's own scrollTop can already be past the trigger point
      // during fast/momentum scrolling on mobile, where scroll events fire
      // too sparsely to catch the threshold crossing in time. Polling every
      // frame while position stays near the danger zone closes that gap, so
      // loading starts with a comfortable lead instead of several small
      // catch-up loads landing back-to-back once already at the edge.
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
      scrollToBottomBtn.classList.toggle("visible", !_stickyToBottom && !overlayOpen && !emptyPlaceholder);
      composerFabBtn?.classList.toggle("visible", (_stickyToBottom || emptyPlaceholder) && !overlayOpen);
    };
    let centeredRowRaf = 0;
    const updateCenteredMessageRow = () => {
      const rows = Array.from(document.querySelectorAll("#messages article.message-row"));
      rows.forEach((row) => row.classList.remove("is-centered"));
      const useCenterHighlight = window.matchMedia("(hover: none), (pointer: coarse)").matches;
      if (!useCenterHighlight || !rows.length) return;
      const timelineRect = timeline.getBoundingClientRect();
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
    timeline.addEventListener("scroll", updateScrollBtn, { passive: true });
    timeline.addEventListener("scroll", requestCenteredMessageRowUpdate, { passive: true });
    window.addEventListener("resize", requestCenteredMessageRowUpdate);
