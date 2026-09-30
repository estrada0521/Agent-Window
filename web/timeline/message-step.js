    const messageStepTopGap = () => {
      const value = parseFloat(getComputedStyle(messagesEl).scrollPaddingTop);
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    };
    const positionConversationRowAtStepTop = (row, behavior) => {
      const timelineTop = messagesEl.getBoundingClientRect().top;
      const top = messagesEl.scrollTop + row.getBoundingClientRect().top - timelineTop - messageStepTopGap();
      messagesEl.scrollTo({ top, behavior });
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
      messagesEl.scrollTo({ top: 0, behavior: "smooth" });
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
    const STEP_ANCHOR_MS = 1200;
    const OLDER_SEARCH_LIMIT = 2000;
    const OLDER_SEARCH_BATCH = 500;
    let _stepAnchor = null;
    const stepRows = (senders) => [...messagesEl.querySelectorAll("article.message-row")]
      .filter((row) => !senders || senders.includes(row.dataset.sender));
    const findStepTarget = (rows, down, anchor) => {
      if (anchor) {
        if (down) return rows.find((row) => anchor.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) || null;
        return rows.filter((row) => anchor.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING).at(-1) || null;
      }
      const stepTop = messagesEl.getBoundingClientRect().top + messageStepTopGap();
      if (down) return rows.find((row) => row.getBoundingClientRect().top - stepTop > 2) || null;
      return rows.filter((row) => row.getBoundingClientRect().top - stepTop < -2).at(-1) || null;
    };
    const findOlderStepTarget = async (senders, anchor) => {
      const loadedEntries = () => displayEntriesForData(latestPayloadData).length;
      const start = loadedEntries();
      let target = findStepTarget(stepRows(senders), false, anchor);
      while (!target && olderHasMore && loadedEntries() - start < OLDER_SEARCH_LIMIT) {
        if (olderLoading) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
        const before = loadedEntries();
        await loadOlderMessages({ limit: OLDER_SEARCH_BATCH });
        if (loadedEntries() === before) break;
        target = findStepTarget(stepRows(senders), false, anchor);
      }
      if (!target) setStatus(`No earlier ${senders.join(", ")} message in the last ${OLDER_SEARCH_LIMIT}`);
      return target;
    };
    const stepConversationByMessage = async (down, senders = null) => {
      if (document.documentElement.dataset.autoWindowHeight === "1") {
        if (typeof fitStepToMessage === "function") void fitStepToMessage(down, senders);
        return;
      }
      const anchor = _stepAnchor?.row.isConnected && performance.now() - _stepAnchor.at < STEP_ANCHOR_MS
        ? _stepAnchor.row
        : null;
      let target = findStepTarget(stepRows(senders), down, anchor);
      if (!target && senders) {
        if (down) return;
        target = await findOlderStepTarget(senders, anchor);
        if (!target) return;
      }
      _stepAnchor = target ? { row: target, at: performance.now() } : null;
      _pollScrollLockTop = null;
      _pollScrollAnchor = null;
      if (!down) _stickyToBottom = false;
      _programmaticScroll = true;
      if (target) positionConversationRowAtStepTop(target, "smooth");
      else messagesEl.scrollTo({ top: down ? messagesEl.scrollHeight : 0, behavior: "smooth" });
      requestAnimationFrame(() => { _programmaticScroll = false; });
    };
    const stepConversationByTarget = (down) =>
      stepConversationByMessage(down, selectedTargets.length ? selectedTargets : ["user"]);
    document.addEventListener("keydown", (event) => {
      if (!event.altKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const active = document.activeElement;
      if (active && active.matches && active.matches("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      void (event.ctrlKey ? stepConversationByTarget : stepConversationByMessage)(event.key === "ArrowDown");
    });
