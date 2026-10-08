    let searchOpen = false;
    let searchRequest = null;
    let searchQuery = "";
    let searchCursors = [];
    let searchIndex = -1;
    const searchHud = document.createElement("form");
    searchHud.className = "search-hud export-hud";
    searchHud.innerHTML = '<button type="button" class="export-hud-cancel" aria-label="Close search" title="Close search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button><input type="search" aria-label="Search messages" placeholder="Search" autocomplete="off"><span role="status"></span><span class="search-arrows"><button type="button" class="search-older" title="Older match (Shift: 10 matches)" aria-label="Older match"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 14 5-5 5 5"/></svg></button><button type="button" class="search-newer" title="Newer match (Shift: 10 matches)" aria-label="Newer match"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 10 5 5 5-5"/></svg></button></span>';
    const searchInput = searchHud.querySelector("input");
    const searchStatus = searchHud.querySelector("[role=status]");
    const searchOlder = searchHud.querySelector(".search-older");
    const searchNewer = searchHud.querySelector(".search-newer");
    const searchMobileNavigation = document.documentElement.dataset.mobile === "1" ? document.createElement("div") : null;
    if (searchMobileNavigation) {
      searchMobileNavigation.className = "mobile-bottom-sheet search-mobile-navigation";
      searchMobileNavigation.hidden = true;
      searchOlder.classList.add("mobile-bottom-sheet-button");
      searchNewer.classList.add("mobile-bottom-sheet-button");
      searchOlder.querySelector("path").setAttribute("d", "M12 19V5m-6 6 6-6 6 6");
      searchNewer.querySelector("path").setAttribute("d", "M12 5v14m-6-6 6 6 6-6");
      searchMobileNavigation.append(searchHud.querySelector(".search-arrows"));
      document.body.append(searchMobileNavigation);
    }
    const syncSearchNavigation = () => {
      searchStatus.textContent = `${searchIndex < 0 ? 0 : searchCursors.length - searchIndex}/${searchCursors.length}`;
      searchOlder.disabled = searchIndex < 0 || searchIndex >= searchCursors.length - 1;
      searchNewer.disabled = searchIndex <= 0;
    };
    const clearSearchHighlight = () => {
      CSS.highlights.delete("timeline-search");
    };
    const highlightSearchResult = (entry) => {
      clearSearchHighlight();
      const row = messagesEl.querySelector(`[data-context-hash="${CSS.escape(entry.context_hash)}"]`);
      if (!row) return;
      expandedMessageBodies.add(entry.context_hash);
      syncMessageCollapse(row);
      const body = row.querySelector(".md-body, .sysmsg-text");
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let text = "";
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement.closest("button, .katex-mathml")) continue;
        nodes.push({ node, start: text.length });
        text += node.textContent;
      }
      const pattern = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const ranges = [];
      for (const match of text.matchAll(pattern)) {
        const end = match.index + match[0].length;
        const first = nodes.findLast((part) => part.start <= match.index);
        const last = nodes.findLast((part) => part.start < end);
        const range = new Range();
        range.setStart(first.node, match.index - first.start);
        range.setEnd(last.node, end - last.start);
        ranges.push(range);
      }
      CSS.highlights.set("timeline-search", new Highlight(...ranges));
      if (ranges.length) {
        const rect = ranges[0].getBoundingClientRect();
        messagesEl.scrollTo({ top: messagesEl.scrollTop + rect.top - messagesEl.getBoundingClientRect().top - (messagesEl.clientHeight - rect.height) / 2, behavior: "auto" });
      }
    };
    const endSearch = () => {
      searchInput.blur();
      searchOpen = false;
      if (searchMobileNavigation) searchMobileNavigation.hidden = true;
      clearSearchHighlight();
      searchRequest?.abort();
      setHudOverlay(null);
    };
    const beginSearch = () => {
      if (exportRange) endExportRange();
      if (isMobileComposer) closeComposerOverlay();
      searchOpen = true;
      if (searchMobileNavigation) searchMobileNavigation.hidden = false;
      setHudOverlay(searchHud);
      if (!isMobileComposer) searchInput.focus({ preventScroll: true });
    };
    const jumpToSearchResult = async (index, request) => {
      const [data, preceding] = await Promise.all([
        { cursor: searchCursors[index] },
        { cursor: searchCursors[index], direction: "before", limit: MESSAGE_BATCH },
      ].map(async (params) => {
        const response = await fetchWithTimeout(messagesFetchUrl(params), { signal: request.signal });
        if (!response.ok) throw new Error("Jump failed");
        return response.json();
      }));
      if (searchRequest !== request || !searchOpen) return;
      const entry = data.entries[0];
      showHistoryWindow({ ...data, entries: [...preceding.entries, ...data.entries], before: preceding.before, has_older: preceding.has_older });
      requestAnimationFrame(() => {
        if (searchOpen && searchRequest === request) highlightSearchResult(entry);
      });
      searchIndex = index;
      syncSearchNavigation();
    };
    const runSearch = async () => {
      const query = searchInput.value.trim();
      if (!query) return;
      searchRequest?.abort();
      const request = new AbortController();
      searchRequest = request;
      clearSearchHighlight();
      searchQuery = query;
      searchCursors = [];
      searchIndex = -1;
      syncSearchNavigation();
      searchStatus.textContent = "…";
      try {
        const response = await fetchWithTimeout(`/messages-search?${new URLSearchParams({ q: query })}`, { signal: request.signal }, 15000);
        if (!response.ok) throw new Error("Search failed");
        const data = await response.json();
        if (searchRequest !== request || !searchOpen) return;
        searchCursors = data.cursors;
        if (searchCursors.length) await jumpToSearchResult(0, request);
        else syncSearchNavigation();
      } catch (error) {
        if (!request.signal.aborted) setError("Search failed", error);
      }
    };
    const stepSearch = async (direction) => {
      if (searchIndex < 0) return;
      const index = Math.max(0, Math.min(searchCursors.length - 1, searchIndex + direction));
      if (index === searchIndex) return;
      searchRequest?.abort();
      const request = new AbortController();
      searchRequest = request;
      try {
        await jumpToSearchResult(index, request);
      } catch (error) {
        if (!request.signal.aborted) setError("Jump failed", error);
      }
    };
    syncSearchNavigation();
    searchHud.querySelector(".export-hud-cancel").addEventListener("click", endSearch);
    searchHud.addEventListener("submit", (event) => {
      event.preventDefault();
      if (isMobileComposer) searchInput.blur();
      if (searchInput.value.trim() !== searchQuery || searchIndex < 0) void runSearch();
      else if (!searchOlder.disabled) void stepSearch(1);
    });
    searchOlder.addEventListener("click", (event) => void stepSearch(event.shiftKey ? 10 : 1));
    searchNewer.addEventListener("click", (event) => void stepSearch(event.shiftKey ? -10 : -1));
    searchInput.addEventListener("keydown", (event) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void stepSearch((event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1));
    });
    document.addEventListener("keydown", (event) => {
      if (!searchOpen || event.isComposing || event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      endSearch();
    }, true);
