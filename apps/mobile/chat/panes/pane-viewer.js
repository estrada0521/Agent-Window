__CHAT_INCLUDE:../../../shared/chat/pane-trace-html.js__

    const PANE_VIEWER_TERMINAL_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M4.5,1 H19.5 A3.5,3.5 0 0 1 23,4.5 V19.5 A3.5,3.5 0 0 1 19.5,23 H4.5 A3.5,3.5 0 0 1 1,19.5 V4.5 A3.5,3.5 0 0 1 4.5,1 Z M7.2,8.3 L11.3,12 L7.2,15.7 L5.7,14.3 L8.5,12 L5.7,9.7 Z M12.4,14.4 L16,14.4 A0.9,0.9 0 0 1 16.8,15.3 A0.9,0.9 0 0 1 16,16.2 L12.4,16.2 A0.9,0.9 0 0 1 11.6,15.3 A0.9,0.9 0 0 1 12.4,14.4 Z"/></svg>';
    const paneViewerTerminalTabIconHtml = () =>
      `<span class="agent-icon-slot agent-icon-slot--pane-tab"><span class="pane-viewer-tab-icon" aria-hidden="true" style="--agent-icon-mask:url('data:image/svg+xml,${encodeURIComponent(PANE_VIEWER_TERMINAL_ICON_SVG)}')"></span></span>`;
    let paneViewerAgents = [];
    let paneViewerLastAgent = null;
    let paneViewerContentCache = Object.create(null);
    const paneViewerEl = document.getElementById("paneViewer");
    const paneViewerTabs = document.getElementById("paneViewerTabs");
    const paneViewerCarousel = document.getElementById("paneViewerCarousel");
    const paneViewerMacroSelect = document.getElementById("paneViewerMacroSelect");
    paneViewerMacroSelect?.addEventListener("change", () => {
      const commandId = String(paneViewerMacroSelect.value || "");
      paneViewerMacroSelect.value = "";
      const agent = paneViewerAgents[lastPaneViewerTabIdx];
      if (!commandId || !agent) return;
      void postShortcutCommand({ command_id: commandId, arg: "", target: agent });
    });
    paneViewerMacroSelect?.addEventListener("blur", () => {
      setTimeout(() => { paneViewerMacroSelect.value = ""; }, 0);
    });
    document.getElementById("paneViewerShortcuts")?.querySelectorAll(".pane-viewer-shortcut-btn[data-shortcut]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const agent = paneViewerAgents[lastPaneViewerTabIdx];
        if (!agent) return;
        void postShortcutCommand({ command_id: btn.dataset.shortcut, arg: "", target: agent });
      });
    });
    const scrollPaneSlideToBottom = (slide) => {
      if (!slide) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          slide.scrollTop = slide.scrollHeight;
        });
      });
    };
    const _paneSlideAtBottom = (el) => !el || el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    const fetchPaneViewerSlide = async (agent, slide, scrollToBottomAfter) => {
      if (!slide) return;
      if (!paneViewerEl?.classList?.contains("visible")) return;
      if (document.hidden) return;
      const body = slide.querySelector(".pane-viewer-body");
      if (!body) return;
      if (!scrollToBottomAfter && !_paneSlideAtBottom(body)) return;
      try {
        const res = await fetch(`/trace?agent=${encodeURIComponent(agent)}&lines=160&ts=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!paneViewerEl?.classList?.contains("visible")) return;
        if (document.hidden) return;
        const content = String(data.content || "");
        const atBottom = _paneSlideAtBottom(body);
        const cacheKey = `${agent}`;
        if (!scrollToBottomAfter && paneViewerContentCache[cacheKey] === content) {
          return;
        }
        paneViewerContentCache[cacheKey] = content;
        body.classList.remove("inline-loading-pane");
        body.innerHTML = paneTraceHtml(content || "No output");
        if (scrollToBottomAfter || atBottom) scrollPaneSlideToBottom(body);
      } catch (_) { }
    };
    const fetchPaneViewerSlideByIndex = (idx, scrollToBottomAfter = false) => {
      if (!paneViewerCarousel || !paneViewerAgents.length) return;
      const i = Math.max(0, Math.min(paneViewerAgents.length - 1, idx));
      const agent = paneViewerAgents[i];
      const slide = paneViewerCarousel.children[i];
      if (agent && slide) fetchPaneViewerSlide(agent, slide, scrollToBottomAfter);
    };
    const fetchVisiblePaneViewerSlide = (scrollToBottomAfter = false) => {
      if (!paneViewerEl?.classList?.contains("visible")) return;
      if (document.hidden) return;
      if (!paneViewerCarousel || !paneViewerAgents.length) return;
      const width = paneViewerCarousel.offsetWidth;
      if (!width) {
        fetchPaneViewerSlideByIndex(lastPaneViewerTabIdx, scrollToBottomAfter);
        return;
      }
      const scrollLeft = paneViewerCarousel.scrollLeft;
      let idx = Math.round(scrollLeft / width);
      if (!Number.isFinite(idx)) idx = 0;
      idx = Math.max(0, Math.min(paneViewerAgents.length - 1, idx));
      fetchPaneViewerSlideByIndex(idx, scrollToBottomAfter);
    };
    let paneViewerIgnoreCarouselTabSync = false;
    function movePaneViewerIndicator(idx, { scrollTabIntoView = false } = {}) {
      const indicator = paneViewerTabs.querySelector(".pane-viewer-tab-indicator");
      const tabs = Array.from(paneViewerTabs.querySelectorAll(".pane-viewer-tab"));
      if (!indicator || !tabs.length) return;
      const safeIdx = Math.max(0, Math.min(tabs.length - 1, idx));
      const tab = tabs[safeIdx];
      if (scrollTabIntoView) {
        const vis = tab.offsetLeft - paneViewerTabs.scrollLeft;
        if (vis < 0 || vis + tab.offsetWidth > paneViewerTabs.clientWidth) {
          tab.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
        }
      }
      indicator.style.left = tab.offsetLeft + "px";
      indicator.style.width = tab.offsetWidth + "px";
    }
    const syncPaneViewerTab = () => {
      if (!paneViewerCarousel || !paneViewerAgents.length) return;
      const width = paneViewerCarousel.offsetWidth;
      if (!width) return;
      const scrollLeft = paneViewerCarousel.scrollLeft;
      let idx = Math.round(scrollLeft / width);
      if (!Number.isFinite(idx)) idx = 0;
      idx = Math.max(0, Math.min(paneViewerAgents.length - 1, idx));
      if (paneViewerIgnoreCarouselTabSync) return;
      lastPaneViewerTabIdx = idx;
      paneViewerLastAgent = paneViewerAgents[idx];
      const tabs = Array.from(paneViewerTabs.querySelectorAll(".pane-viewer-tab"));
      tabs.forEach((t, i) => t.classList.toggle("active", i === idx));
      movePaneViewerIndicator(idx);
    };
    const onPaneViewerCarouselScroll = () => {
      if (!paneViewerTabScrollRaf) {
        paneViewerTabScrollRaf = requestAnimationFrame(() => {
          paneViewerTabScrollRaf = 0;
          syncPaneViewerTab();
        });
      }
      if (paneViewerTabScrollEndTimer) clearTimeout(paneViewerTabScrollEndTimer);
      paneViewerTabScrollEndTimer = setTimeout(() => {
        paneViewerTabScrollEndTimer = null;
        const tapped = paneViewerIgnoreCarouselTabSync;
        paneViewerIgnoreCarouselTabSync = false;
        if (tapped) syncPaneViewerTab();
        else movePaneViewerIndicator(lastPaneViewerTabIdx, { scrollTabIntoView: true });
        fetchVisiblePaneViewerSlide(false);
      }, 120);
    };
    const schedulePaneViewerScrollAlign = () => {
      let tries = 0;
      const run = () => {
        if (!paneViewerCarousel || !paneViewerAgents.length) return;
        const w = paneViewerCarousel.offsetWidth;
        if (!w) {
          if (++tries > 48) return;
          requestAnimationFrame(run);
          return;
        }
        const agent = paneViewerLastAgent && paneViewerAgents.includes(paneViewerLastAgent)
          ? paneViewerLastAgent
          : paneViewerAgents[0];
        const idx = Math.max(0, paneViewerAgents.indexOf(agent));
        paneViewerCarousel.scrollTo({ left: idx * w, behavior: "auto" });
        syncPaneViewerTab();
        requestAnimationFrame(() => {
          movePaneViewerIndicator(lastPaneViewerTabIdx, { scrollTabIntoView: true });
        });
      };
      requestAnimationFrame(() => requestAnimationFrame(run));
    };
    const scrollToAgent = (agent) => {
      const idx = paneViewerAgents.indexOf(agent);
      if (idx < 0) return;
      lastPaneViewerTabIdx = idx;
      paneViewerLastAgent = agent;
      paneViewerIgnoreCarouselTabSync = true;
      paneViewerCarousel.scrollTo({ left: idx * paneViewerCarousel.offsetWidth, behavior: "smooth" });
      const tabs = Array.from(paneViewerTabs.querySelectorAll(".pane-viewer-tab"));
      tabs.forEach((t, i) => t.classList.toggle("active", i === idx));
      movePaneViewerIndicator(idx, { scrollTabIntoView: true });
      fetchPaneViewerSlideByIndex(idx, true);
    };
    const buildPaneViewer = () => {
      paneViewerAgents = availableTargets.filter(t => t !== "others");
      if (sessionActive) paneViewerAgents = ["terminal", ...paneViewerAgents];
      const restoreAgent = paneViewerLastAgent && paneViewerAgents.includes(paneViewerLastAgent)
        ? paneViewerLastAgent
        : paneViewerAgents[0];
      const initialIdx = restoreAgent ? Math.max(0, paneViewerAgents.indexOf(restoreAgent)) : 0;
      paneViewerTabs.innerHTML = `<div class="pane-viewer-tab-indicator"></div>` + paneViewerAgents.map((a, i) =>
        `<button class="pane-viewer-tab${i === initialIdx ? " active" : ""}" data-agent="${escapeHtml(a)}" title="${escapeHtml(a)}" aria-label="${escapeHtml(a)}">${a === "terminal" ? paneViewerTerminalTabIconHtml() : paneViewerTabIconHtml(a)}</button>`
      ).join("");
      paneViewerCarousel.innerHTML = paneViewerAgents.map(a =>
        `<div class="pane-viewer-slide" data-agent="${escapeHtml(a)}"><div class="pane-viewer-header-shadow"></div><div class="pane-viewer-body inline-loading-pane">${loadingIndicatorHtml()}</div></div>`
      ).join("");
      paneViewerTabs.querySelectorAll(".pane-viewer-tab").forEach(tab => {
        tab.addEventListener("click", () => scrollToAgent(tab.dataset.agent));
      });
      if (paneViewerCarousel && !paneViewerCarousel._paneViewerScrollBound) {
        paneViewerCarousel._paneViewerScrollBound = true;
        paneViewerCarousel.addEventListener("scroll", onPaneViewerCarouselScroll, { passive: true });
      }
      lastPaneViewerTabIdx = initialIdx;
      requestAnimationFrame(() => {
        movePaneViewerIndicator(initialIdx);
        const firstTab = paneViewerTabs.querySelector(".pane-viewer-tab.active");
        if (firstTab) firstTab.scrollIntoView({ inline: "center", block: "nearest" });
      });
    };
    const resolvePaneFocusAgent = (raw) => {
      if (!raw) return null;
      const allowed = availableTargets.filter(t => t !== "others");
      if (!allowed.length) return null;
      if (allowed.includes(raw)) return raw;
      const base = agentBaseName(raw);
      const hit = allowed.find((t) => t === base || agentBaseName(t) === base);
      return hit || null;
    };
    const showPaneTraceViewer = (focusAgent) => {
      if (!paneViewerEl || !paneTracePanel) return;
      const resolved = resolvePaneFocusAgent(focusAgent);
      if (resolved) paneViewerLastAgent = resolved;
      if (paneTracePanel.classList.contains("open")) {
        if (resolved && paneViewerAgents.includes(resolved)) {
          scrollToAgent(resolved);
        }
        return;
      }
      closeSheet({ immediate: true });

      paneViewerEl.classList.remove("visible");
      paneViewerEl.hidden = true;
      _ignoreGlobalClick = true;

      openPaneTraceSheet(() => {
        paneViewerEl.hidden = false;
        paneViewerEl.classList.add("visible");
        paneViewerContentCache = Object.create(null);
        syncHeaderMenuFocus();
        clearPaneViewerOpenWork();
        paneViewerOpenRaf = requestAnimationFrame(() => {
          paneViewerOpenRaf = 0;
          buildPaneViewer();
          schedulePaneViewerScrollAlign();
          paneViewerInitialFetchTimer = setTimeout(() => {
            paneViewerInitialFetchTimer = 0;
            fetchPaneViewerSlideByIndex(lastPaneViewerTabIdx, true);
            if (paneViewerInterval) clearInterval(paneViewerInterval);
            paneViewerInterval = setInterval(() => fetchVisiblePaneViewerSlide(false), 500);
          }, 24);
        });
      });
    };
    const togglePaneViewer = () => {
      if (!paneViewerEl || !paneTracePanel) return;
      if (paneTracePanel.classList.contains("open")) {
        exitPaneTraceMode();
        return;
      }
      showPaneTraceViewer(null);
    };
    let _thinkingRowTouch = null;
    let _lastThinkingPaneMs = 0;
    const msgThinking = document.getElementById("messages");
    if (msgThinking) {
      msgThinking.addEventListener("touchstart", (e) => {
        const row = e.target.closest(".message-thinking-row");
        if (!row || !row.dataset.agent) {
          _thinkingRowTouch = null;
          return;
        }
        const t = e.touches && e.touches[0];
        if (!t) {
          _thinkingRowTouch = null;
          return;
        }
        _thinkingRowTouch = {
          agent: row.dataset.agent || "",
          x: t.clientX,
          y: t.clientY,
        };
      }, { passive: true });
      msgThinking.addEventListener("touchend", (e) => {
        if (!_thinkingRowTouch) return;
        const start = _thinkingRowTouch;
        _thinkingRowTouch = null;
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
        _thinkingRowTouch = null;
      }, { passive: true });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (!paneViewerEl?.classList?.contains("visible")) return;
      fetchVisiblePaneViewerSlide(false);
    });
    refreshSessionState(["statuses"]);
