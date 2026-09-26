    const STICKY_THRESHOLD = 32;
    const OLDER_AUTOLOAD_MIN_THRESHOLD = 480;
    let _stickyToBottom = false;
    let _programmaticScroll = false;
    let _pinStickyThroughWidthChange = false;
    let _viewportCenterAnchor = null;
    let _anchorLayoutWidth = messagesEl.clientWidth;
    let _atBottomAtAnchorWidth = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= 2;
    let _pollScrollRestoreRaf = 0;
    const maybeRestorePollScrollLock = () => {
      if (_programmaticScroll) return;
      const hasAnchor = _pollScrollAnchor && _pollScrollAnchor.contextHash;
      const hasLock = _pollScrollLockTop != null;
      if (!hasAnchor && !hasLock) return;

      if (hasAnchor) {
        const row = messagesEl.querySelector(`[data-context-hash="${CSS.escape(String(_pollScrollAnchor.contextHash))}"]`);
        if (row) {
          const tRect = messagesEl.getBoundingClientRect();
          const drift = (row.getBoundingClientRect().top - tRect.top) - _pollScrollAnchor.vpTop;
          if (Math.abs(drift) > 0.5) {
            _programmaticScroll = true;
            messagesEl.scrollTop += drift;
            const maxTop = Math.max(0, messagesEl.scrollHeight - messagesEl.clientHeight);
            messagesEl.scrollTop = Math.min(Math.max(0, messagesEl.scrollTop), maxTop);
            _pollScrollLockTop = messagesEl.scrollTop;
            queueMicrotask(() => { _programmaticScroll = false; });
            return;
          }
        }
      }
      if (!hasLock) return;
      const maxTop = Math.max(0, messagesEl.scrollHeight - messagesEl.clientHeight);
      const target = Math.min(_pollScrollLockTop, maxTop);
      if (Math.abs(messagesEl.scrollTop - target) > 0.5) {
        _programmaticScroll = true;
        messagesEl.scrollTop = target;
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
        new MutationObserver(() => schedulePollScrollRestore()).observe(messagesEl, {
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
      const tRect = messagesEl.getBoundingClientRect();
      const midY = tRect.top + messagesEl.clientHeight / 2;
      let fallback = null;
      for (const el of messagesEl.querySelectorAll("[data-context-hash]")) {
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
      if (_pinStickyThroughWidthChange) return;
      if (messagesEl.clientWidth !== _anchorLayoutWidth) return;
      _atBottomAtAnchorWidth = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= 2;
      if (_programmaticScroll) return;
      _viewportCenterAnchor = captureViewportCenterAnchor();
    };
    const restoreViewportCenterAnchor = (anchor) => {
      if (!anchor?.contextHash) return;
      const row = messagesEl.querySelector(`[data-context-hash="${CSS.escape(String(anchor.contextHash))}"]`);
      if (!row) return;
      const tRect = messagesEl.getBoundingClientRect();
      const midY = tRect.top + messagesEl.clientHeight / 2;
      const drift = (row.getBoundingClientRect().top + anchor.offsetInRow) - midY;
      if (Math.abs(drift) <= 0.5) return;
      _programmaticScroll = true;
      const maxTop = Math.max(0, messagesEl.scrollHeight - messagesEl.clientHeight);
      messagesEl.scrollTop = Math.min(Math.max(0, messagesEl.scrollTop + drift), maxTop);
      queueMicrotask(() => { _programmaticScroll = false; });
    };
    const isNearBottom = () => {
      return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < STICKY_THRESHOLD;
    };
    const isInComposerFabRange = () => {
      const play = parseFloat(getComputedStyle(messagesEl).getPropertyValue("--main-spacer-height"));
      const slack = Number.isFinite(play) && play > 0 ? play : STICKY_THRESHOLD;
      return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < slack;
    };
