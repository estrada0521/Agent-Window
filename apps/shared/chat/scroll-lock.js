    const STICKY_THRESHOLD = 32;
    const OLDER_AUTOLOAD_MIN_THRESHOLD = 480;
    let _stickyToBottom = false;
    let _programmaticScroll = false;
    let _pinStickyThroughWidthChange = false;
    let _viewportCenterAnchor = null;
    let _anchorLayoutWidth = timeline.clientWidth;
    let _pollScrollRestoreRaf = 0;
    const maybeRestorePollScrollLock = () => {
      if (_programmaticScroll) return;
      const hasAnchor = _pollScrollAnchor && _pollScrollAnchor.contextHash;
      const hasLock = _pollScrollLockTop != null;
      if (!hasAnchor && !hasLock) return;

      if (hasAnchor) {
        const row = timeline.querySelector(`[data-context-hash="${CSS.escape(String(_pollScrollAnchor.contextHash))}"]`);
        if (row) {
          const tRect = timeline.getBoundingClientRect();
          const drift = (row.getBoundingClientRect().top - tRect.top) - _pollScrollAnchor.vpTop;
          if (Math.abs(drift) > 0.5) {
            _programmaticScroll = true;
            timeline.scrollTop += drift;
            const maxTop = Math.max(0, timeline.scrollHeight - timeline.clientHeight);
            timeline.scrollTop = Math.min(Math.max(0, timeline.scrollTop), maxTop);
            _pollScrollLockTop = timeline.scrollTop;
            queueMicrotask(() => { _programmaticScroll = false; });
            return;
          }
        }
      }
      if (!hasLock) return;
      const maxTop = Math.max(0, timeline.scrollHeight - timeline.clientHeight);
      const target = Math.min(_pollScrollLockTop, maxTop);
      if (Math.abs(timeline.scrollTop - target) > 0.5) {
        _programmaticScroll = true;
        timeline.scrollTop = target;
        queueMicrotask(() => { _programmaticScroll = false; });
      }
    };
    const schedulePollScrollRestore = () => {
      if (_pollScrollLockTop == null && !(_pollScrollAnchor && _pollScrollAnchor.contextHash)) return;
      if (_pollScrollRestoreRaf) return;
      _pollScrollRestoreRaf = requestAnimationFrame(() => {
        _pollScrollRestoreRaf = 0;
        maybeRestorePollScrollLock();
      });
    };
    if (typeof MutationObserver === "function") {
      try {
        new MutationObserver(() => schedulePollScrollRestore()).observe(timeline, {
          childList: true,
          subtree: true,
        });
      } catch (_) {}
    }
    const settleScrollLockFrames = (remaining) => {
      if (remaining <= 0) return;
      maybeRestorePollScrollLock();
      requestAnimationFrame(() => settleScrollLockFrames(remaining - 1));
    };
    const captureViewportCenterAnchor = () => {
      const tRect = timeline.getBoundingClientRect();
      const midY = tRect.top + timeline.clientHeight / 2;
      let fallback = null;
      for (const el of timeline.querySelectorAll("[data-context-hash]")) {
        const contextHash = String(el.dataset.contextHash || "");
        if (!contextHash) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom <= tRect.top + 0.5) continue;
        if (r.top >= tRect.bottom - 0.5) break;
        const offsetInRow = midY - r.top;
        if (r.top <= midY && r.bottom >= midY) return { contextHash, offsetInRow };
        if (r.bottom <= midY) fallback = { contextHash, offsetInRow };
      }
      return fallback;
    };
    const refreshViewportCenterAnchor = () => {
      if (_programmaticScroll || _pinStickyThroughWidthChange) return;
      if (timeline.clientWidth !== _anchorLayoutWidth) return;
      if (_stickyToBottom || isNearBottom()) {
        _viewportCenterAnchor = null;
        return;
      }
      _viewportCenterAnchor = captureViewportCenterAnchor();
    };
    const restoreViewportCenterAnchor = (anchor) => {
      if (!anchor?.contextHash) return;
      const row = timeline.querySelector(`[data-context-hash="${CSS.escape(String(anchor.contextHash))}"]`);
      if (!row) return;
      const tRect = timeline.getBoundingClientRect();
      const midY = tRect.top + timeline.clientHeight / 2;
      const drift = (row.getBoundingClientRect().top + anchor.offsetInRow) - midY;
      if (Math.abs(drift) <= 0.5) return;
      _programmaticScroll = true;
      const maxTop = Math.max(0, timeline.scrollHeight - timeline.clientHeight);
      timeline.scrollTop = Math.min(Math.max(0, timeline.scrollTop + drift), maxTop);
      queueMicrotask(() => { _programmaticScroll = false; });
    };
    const isNearBottom = () => {
      return timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < STICKY_THRESHOLD;
    };
    const isInComposerFabRange = () => {
      const play = parseFloat(getComputedStyle(timeline).getPropertyValue("--main-spacer-height"));
      const slack = Number.isFinite(play) && play > 0 ? play : STICKY_THRESHOLD;
      return timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < slack;
    };
