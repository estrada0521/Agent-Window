    let _thinkingRowTouch = null;
    let _lastThinkingPaneMs = 0;
    const msgThinking = document.getElementById("messages");
    if (msgThinking) {
      const clearThinkingRowPressed = () => {
        msgThinking.querySelectorAll(".message-thinking-row.is-pressed").forEach((node) => {
          node.classList.remove("is-pressed");
        });
      };
      msgThinking.addEventListener("touchstart", (e) => {
        const row = e.target.closest(".message-thinking-row");
        if (!row || !row.dataset.agent) {
          clearThinkingRowPressed();
          _thinkingRowTouch = null;
          return;
        }
        const t = e.touches && e.touches[0];
        if (!t) {
          clearThinkingRowPressed();
          _thinkingRowTouch = null;
          return;
        }
        clearThinkingRowPressed();
        row.classList.add("is-pressed");
        _thinkingRowTouch = {
          agent: row.dataset.agent || "",
          x: t.clientX,
          y: t.clientY,
          row,
        };
      }, { passive: true });
      msgThinking.addEventListener("touchmove", (e) => {
        const start = _thinkingRowTouch;
        if (!start) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (dx * dx + dy * dy > 100) start.row?.classList.remove("is-pressed");
      }, { passive: true });
      msgThinking.addEventListener("touchend", (e) => {
        if (!_thinkingRowTouch) return;
        const start = _thinkingRowTouch;
        _thinkingRowTouch = null;
        start.row?.classList.remove("is-pressed");
        const row = e.target.closest(".message-thinking-row");
        if (!row) return;
        if ((row.dataset.agent || "") !== (start.agent || "")) return;
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (dx * dx + dy * dy > 100) return;
        const now = Date.now();
        if (now - _lastThinkingPaneMs < 400) return;
        _lastThinkingPaneMs = now;
        _ignoreGlobalClick = true;
        e.preventDefault();
        if (start.agent) {
          showPaneTraceViewer(start.agent);
        }
      }, { passive: false });
      msgThinking.addEventListener("touchcancel", () => {
        clearThinkingRowPressed();
        _thinkingRowTouch = null;
      }, { passive: true });
      const PRESS_SEL = "a.inline-file-link, a.local-file-link, summary";
      let _fileLinkTouch = null;
      const clearFileLinkPressed = () => {
        msgThinking.querySelectorAll(".inline-file-link.is-pressed, .local-file-link.is-pressed, summary.is-pressed").forEach((node) => {
          node.classList.remove("is-pressed");
        });
      };
      msgThinking.addEventListener("touchstart", (e) => {
        const link = e.target.closest(PRESS_SEL);
        const t = e.touches && e.touches[0];
        if (!link || !t) {
          clearFileLinkPressed();
          _fileLinkTouch = null;
          return;
        }
        clearFileLinkPressed();
        link.classList.add("is-pressed");
        _fileLinkTouch = { x: t.clientX, y: t.clientY, link };
      }, { passive: true });
      msgThinking.addEventListener("touchmove", (e) => {
        const start = _fileLinkTouch;
        if (!start) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (dx * dx + dy * dy > 100) start.link?.classList.remove("is-pressed");
      }, { passive: true });
      msgThinking.addEventListener("touchend", () => {
        _fileLinkTouch = null;
        clearFileLinkPressed();
      }, { passive: true });
      msgThinking.addEventListener("touchcancel", () => {
        _fileLinkTouch = null;
        clearFileLinkPressed();
      }, { passive: true });
      msgThinking.addEventListener("contextmenu", (e) => {
        if (e.target.closest(PRESS_SEL)) e.preventDefault();
      });
    }
