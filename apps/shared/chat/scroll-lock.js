    const STICKY_THRESHOLD = 32;
    const OLDER_AUTOLOAD_MIN_THRESHOLD = 480;
    let _stickyToBottom = false;
    let _programmaticScroll = false;
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
    const isNearBottom = () => {
      return timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < STICKY_THRESHOLD;
    };
