    let lastRenderPrepended = false;
    let renderFailed = false;
    let _firstContentSettleFired = false;
    const render = (data, {
      forceScroll = false,
      forceFullRender = false,
      suppressEntryAnimation = false,
    } = {}) => {
      try {
        lastRenderPrepended = false;
        const shouldStick = forceScroll || (!historyWindow && (_stickyToBottom || isNearBottom()));
        const displayEntries = displayEntriesForData(data);
        const metaHiddenIds = computeMetaHiddenIds(displayEntries);
        const previousRenderedIds = new Set(_renderedIds);

        updateMessageProjectionUI(displayEntries);

        const renderSig = displayEntries.map((entry) => entryRenderKey(entry)).join("\u0002");
        if (!forceScroll && renderSig === lastMessagesSig) return;
        lastMessagesSig = renderSig;

        initialLoadDone = true;

        const root = document.getElementById("messages");
        if (!displayEntries.length) {
          _renderedIds.clear();
          root.innerHTML = emptyConversationHTML();
          renderThinkingIndicator();
          updateScrollBtn();
          return;
        }

        const preserveScrollTop = shouldStick ? null : messagesEl.scrollTop;
        let scrollAnchor = null;
        if (!shouldStick) {
          const tRect = messagesEl.getBoundingClientRect();
          for (const el of messagesEl.querySelectorAll("[data-context-hash]")) {
            const mid = String(el.dataset.contextHash || "");
            if (!mid) continue;
            const r = el.getBoundingClientRect();
            if (r.bottom <= tRect.top + 0.5) continue;
            if (r.top >= tRect.bottom - 0.5) break;
            scrollAnchor = { contextHash: mid, vpTop: r.top - tRect.top };
            break;
          }
        }

        const displayIdSet = new Set(displayEntries.map((e) => e.context_hash));
        const newEntries = displayEntries.filter((e) => {
          const id = e.context_hash;
          return !previousRenderedIds.has(id);
        });
        const hasRemovals = previousRenderedIds.size > 0 && [...previousRenderedIds].some((id) => !displayIdSet.has(String(id)));
        const currentRenderedOrder = Array.from(root.querySelectorAll("[data-context-hash]"))
          .map((node) => String(node.dataset.contextHash || ""))
          .filter(Boolean);
        const nextRenderedOrder = displayEntries.map((entry) => entry.context_hash);
        const nextIncrementalOrder = currentRenderedOrder
          .filter((id) => displayIdSet.has(id))
          .concat(newEntries.map((entry) => entry.context_hash));
        const canIncrementallyTrimAndAppend = !forceFullRender
          && previousRenderedIds.size > 0
          && newEntries.length > 0
          && nextIncrementalOrder.length === nextRenderedOrder.length
          && nextIncrementalOrder.every((id, idx) => id === nextRenderedOrder[idx]);
        const canIncrementallyPrepend = !forceFullRender
          && previousRenderedIds.size > 0
          && newEntries.length > 0
          && !hasRemovals
          && nextRenderedOrder.length === currentRenderedOrder.length + newEntries.length
          && newEntries.every((entry, idx) => nextRenderedOrder[idx] === entry.context_hash)
          && currentRenderedOrder.every((id, idx) => nextRenderedOrder[idx + newEntries.length] === id);

        const isInitialBulkLoad =
          previousRenderedIds.size === 0
          && newEntries.length > 0
          && newEntries.length === displayEntries.length
          && displayEntries.length > 1;
        const shouldMarkNewRowsAnimated =
          newEntries.length > 0
          && !isInitialBulkLoad
          && !suppressEntryAnimation
          && (previousRenderedIds.size > 0 || displayEntries.length === 1);

        let pendingStreamRowCleanups = [];
        if (canIncrementallyTrimAndAppend) {
          if (hasRemovals) {
            root.querySelectorAll("[data-context-hash]").forEach((node) => {
              const contextHash = String(node.dataset.contextHash || "");
              if (contextHash && !displayIdSet.has(contextHash)) node.remove();
            });
          }
          const frag = document.createDocumentFragment();
          const pendingRowCleanup = [];
          for (const entry of newEntries) {
            const entryContextHash = entry.context_hash;
            const tmpl = document.createElement("template");
            tmpl.innerHTML = buildMsgHTML(entry, {
              hideMetaRow: metaHiddenIds.has(entryContextHash),
            });
            const row = tmpl.content.firstElementChild;
            if (row) {
              const stream = shouldMarkNewRowsAnimated && entryQualifiesForStreamReveal(entry);
              if (shouldMarkNewRowsAnimated) row.classList.add("animate-in");
              if (stream) row.classList.add("streaming-body-reveal");
              pendingRowCleanup.push({ row, stream });
            }
            frag.appendChild(tmpl.content);
          }
          root.appendChild(frag);
          _renderedIds = displayIdSet;
          for (const { row } of pendingRowCleanup) {
            if (row.isConnected) postRenderScope(row);
          }
          pendingStreamRowCleanups = shouldMarkNewRowsAnimated ? pendingRowCleanup : [];
        } else if (canIncrementallyPrepend) {
          const heightBefore = messagesEl.scrollHeight;
          const topBefore = messagesEl.scrollTop;
          const frag = document.createDocumentFragment();
          const pendingRowCleanup = [];
          for (const entry of newEntries) {
            const entryContextHash = entry.context_hash;
            const tmpl = document.createElement("template");
            tmpl.innerHTML = buildMsgHTML(entry, {
              hideMetaRow: metaHiddenIds.has(entryContextHash),
            });
            const row = tmpl.content.firstElementChild;
            if (row) pendingRowCleanup.push({ row, stream: false });
            frag.appendChild(tmpl.content);
          }
          const firstMsg = root.querySelector("[data-context-hash]");
          root.insertBefore(frag, firstMsg || root.firstChild);
          _renderedIds = displayIdSet;
          for (const { row } of pendingRowCleanup) {
            if (row.isConnected) postRenderScope(row);
          }
          pendingStreamRowCleanups = [];
          void messagesEl.offsetHeight;
          _programmaticScroll = true;
          messagesEl.scrollTop = topBefore + (messagesEl.scrollHeight - heightBefore);
          _pollScrollLockTop = messagesEl.scrollTop;
          _pollScrollAnchor = scrollAnchor;
          lastRenderPrepended = true;
          queueMicrotask(() => { _programmaticScroll = false; });
        } else {
          root.innerHTML = displayEntries.map((entry) => {
            const entryContextHash = entry.context_hash;
            return buildMsgHTML(entry, {
              hideMetaRow: metaHiddenIds.has(entryContextHash),
            });
          }).join("");
          _renderedIds = displayIdSet;
          const pendingFullRowCleanup = [];
          if (shouldMarkNewRowsAnimated) {
            const newEntryById = new Map(newEntries.map((e) => [e.context_hash, e]));
            root.querySelectorAll("[data-context-hash]").forEach((row) => {
              const contextHash = String(row.dataset.contextHash || "");
              const entry = newEntryById.get(contextHash);
              if (!contextHash || !entry) return;
              row.classList.add("animate-in");
              const stream = entryQualifiesForStreamReveal(entry);
              if (stream) row.classList.add("streaming-body-reveal");
              pendingFullRowCleanup.push({ row, stream });
            });
          }
          postRenderScope(root);
          pendingStreamRowCleanups = pendingFullRowCleanup;
        }

        queueStableCodeBlockSync(root);
        pendingStreamRowCleanups.forEach(({ row, stream }) => {
          if (stream) applyStreamRevealToRow(row);
          scheduleAnimateInCleanup(row, { streamBody: stream });
        });
        renderThinkingIndicator();

        if (canIncrementallyPrepend) {
          _stickyToBottom = isNearBottom();
          requestAnimationFrame(() => {
            requestAnimationFrame(maybeRestorePollScrollLock);
          });
          settleScrollLockFrames(10);
        } else if (shouldStick) {
          _pollScrollLockTop = null;
          _pollScrollAnchor = null;
          _programmaticScroll = true;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          queueMicrotask(() => { _programmaticScroll = false; });
        } else if (preserveScrollTop != null) {
          const maxTop = Math.max(0, messagesEl.scrollHeight - messagesEl.clientHeight);
          _programmaticScroll = true;
          const applied = Math.min(preserveScrollTop, maxTop);
          messagesEl.scrollTop = applied;
          _pollScrollLockTop = applied;
          _pollScrollAnchor = scrollAnchor;
          queueMicrotask(() => { _programmaticScroll = false; });
          requestAnimationFrame(() => {
            requestAnimationFrame(maybeRestorePollScrollLock);
          });
          settleScrollLockFrames(10);
        }
        _stickyToBottom = isNearBottom();
        refreshViewportCenterAnchor();
        updateScrollBtn();
        requestCenteredMessageRowUpdate();
        updateSendBtnVisibility();
        if (pendingStreamRowCleanups.length || !_firstContentSettleFired) {
          _firstContentSettleFired = true;
          document.dispatchEvent(new CustomEvent("timeline-transcript-settled"));
        }
        if (renderFailed) {
          renderFailed = false;
          setResidentError("render-failed", "");
        }
      } catch (err) {
        console.error("timeline render failed", err);
        document.getElementById("messages").replaceChildren();
        _renderedIds.clear();
        lastMessagesSig = "";
        updateScrollBtn();
        renderFailed = true;
        setResidentError("render-failed", "Render failed");
        throw err;
      }
    };
__INCLUDE:../hud.js__
    const { setStatus, setError, setResidentStatus, setResidentError, setOverlay: setHudOverlay, setBackgroundStatus, setCovered: setHudCovered } = createHud(document.getElementById("timelineHud"), (visible) => {
      window.parent?.postMessage({ type: "timeline-hud-visible", visible }, "*");
    });
    const agentActionCandidates = (mode) => {
      if (mode === "add") return ALL_BASE_AGENTS.filter(Boolean);
      return availableTargets;
    };
    const syncSessionMenuOptions = () => {
      document.querySelectorAll('option:is([value="addAgent"], [value="openPaneTraceWindow"])').forEach((option) => {
        option.disabled = !sessionActive;
      });
      document.querySelectorAll('option[value="removeAgent"]').forEach((option) => {
        option.disabled = !sessionActive || !availableTargets.length;
      });
    };
    const performAgentAction = async (mode, selected) => {
      if (!selected) return;
      const adding = mode === "add";
      setStatus("");
      try {
        const res = await fetch(adding ? "/add-agent" : "/remove-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: selected }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `failed to ${adding ? "add" : "remove"} agent`);
        }
      } catch (err) {
        setError(`${adding ? "Add" : "Remove"} agent failed`, err);
      }
    };
    let subMenuPick = null;
    let skipSubMenuBlur = false;
    const resetSubMenu = ({ clearOptions = false } = {}) => {
      const select = document.getElementById("subMenuNativeSelect");
      if (!select) return;
      select.value = "";
      if (clearOptions) {
        select.innerHTML = '<option value="" disabled selected>Menu</option>';
      }
      select.style.top = "-9999px";
      select.style.left = "-9999px";
    };
    const subMenuIsArmed = () => {
      const select = document.getElementById("subMenuNativeSelect");
      if (!select) return false;
      return select.options.length > 1 && select.style.top !== "-9999px";
    };
    const showArmedSubMenu = () => {
      const select = document.getElementById("subMenuNativeSelect");
      if (!select || !subMenuIsArmed()) return false;
      openNativeSelect(select);
      return true;
    };
    const ensureSubMenu = () => {
      let select = document.getElementById("subMenuNativeSelect");
      if (select) return select;
      select = document.createElement("select");
      select.id = "subMenuNativeSelect";
      select.setAttribute("aria-hidden", "true");
      select.tabIndex = -1;
      select.style.position = "fixed";
      select.style.top = "-9999px";
      select.style.left = "-9999px";
      select.style.width = "1px";
      select.style.height = "1px";
      select.style.opacity = "0.001";
      select.style.pointerEvents = "auto";
      select.style.appearance = "none";
      select.style.webkitAppearance = "none";
      select.style.border = "0";
      select.style.outline = "none";
      select.style.background = "transparent";
      select.style.color = "transparent";
      select.style.fontSize = "13px";
      select.style.zIndex = "1000";
      select.addEventListener("change", () => {
        const value = String(select.value || "");
        const pick = subMenuPick;
        resetSubMenu({ clearOptions: true });
        if (value && pick) pick(value);
      });
      select.addEventListener("blur", () => {
        setTimeout(() => {
          if (skipSubMenuBlur) return;
          resetSubMenu({ clearOptions: true });
        }, 0);
      });
      document.body.appendChild(select);
      return select;
    };
    const anchorSubMenu = (select, anchor = null) => {
      const baseAnchor = rightMenuBtn || document.activeElement || document.body;
      if (document.documentElement.dataset.mobile === "1") {
        const baseRect = baseAnchor.getBoundingClientRect ? baseAnchor.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
        const anchorRect = anchor?.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
        const left = anchorRect ? anchorRect.left : baseRect.left;
        const width = anchorRect ? anchorRect.width : baseRect.width;
        select.style.left = `${Math.max(0, Math.round(left))}px`;
        select.style.top = `${Math.max(0, Math.round(baseRect.top))}px`;
        select.style.width = `${Math.max(1, Math.round(width || 1))}px`;
        select.style.height = `${Math.max(1, Math.round(baseRect.height || 1))}px`;
        return;
      }
      const anchorEl = anchor || baseAnchor;
      const rect = anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : { left: 0, top: 0, right: 0, width: 1, height: 1 };
      const gap = 8;
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const width = 220;
      const height = Math.max(1, Math.round(rect.height || 28));
      const rightSideLeft = Math.round((rect.right || ((rect.left || 0) + (rect.width || 1))) + gap);
      const fallbackLeft = Math.round((rect.left || 0) - width - gap);
      const left = (vw && rightSideLeft + width > vw - 8)
        ? Math.max(8, fallbackLeft)
        : Math.max(0, rightSideLeft);
      select.style.left = `${left}px`;
      select.style.top = `${Math.max(0, Math.round(rect.top || 0))}px`;
      select.style.width = `${width}px`;
      select.style.height = `${height}px`;
    };
    const openSubMenu = (title, choices, onPick, anchor = null) => {
      const select = ensureSubMenu();
      resetSubMenu({ clearOptions: true });
      subMenuPick = onPick;
      select.innerHTML = `<option value="" disabled selected>${escapeHtml(title)}</option>` + choices
        .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
        .join("");
      anchorSubMenu(select, anchor);
      skipSubMenuBlur = document.documentElement.dataset.mobile === "1";
      openNativeSelect(select);
    };
    const openAgentActionMenu = (mode) => {
      openSubMenu(
        mode === "add" ? "Add Agent" : "Remove Agent",
        agentActionCandidates(mode).map((agent) => [agent, agent]),
        (agent) => void performAgentAction(mode, agent),
      );
    };
    const showAddAgentModal = () => {
      openAgentActionMenu("add");
    };
    const showRemoveAgentModal = () => {
      openAgentActionMenu("remove");
    };
    const fetchWithTimeout = async (url, options = {}, timeoutMs = 5000) => {
      let timer = null;
      let timedOut = false;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const requestOptions = {
        cache: "no-store",
        ...options,
      };
      const upstreamSignal = options?.signal || null;
      if (controller) {
        requestOptions.signal = controller.signal;
        if (upstreamSignal) {
          if (upstreamSignal.aborted) {
            controller.abort();
          } else if (typeof upstreamSignal.addEventListener === "function") {
            upstreamSignal.addEventListener("abort", () => controller.abort(), { once: true });
          }
        }
      } else if (upstreamSignal) {
        requestOptions.signal = upstreamSignal;
      }
      const fetchPromise = fetch(url, requestOptions);
      if (!(timeoutMs > 0)) return fetchPromise;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          try { controller?.abort(); } catch (_) {}
          reject(new Error("request timeout"));
        }, timeoutMs);
      });
      try {
        return await Promise.race([fetchPromise, timeoutPromise]);
      } catch (err) {
        if (timedOut && err?.name === "AbortError") {
          throw new Error("request timeout");
        }
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
        if (timedOut) {
          fetchPromise.catch(() => {});
        }
      }
    };
    const LAUNCH_STAGE_MIN_MS = 700;
    const waitForLaunchStage = () => new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, LAUNCH_STAGE_MIN_MS));
    });
    const setReloadStage = (stage) => {
      if (stage === "error") document.documentElement.removeAttribute("data-launch-shell");
      else document.documentElement.dataset.launchShell = stage;
      if (document.documentElement.hasAttribute("data-mobile-timeline") && window.parent !== window) {
        window.parent.postMessage({ type: "timeline-reload-stage", stage }, "*");
      }
    };
    const reloadTimeline = async () => {
      if (reloadInFlight) return;
      reloadInFlight = true;
      if (document.body.classList.contains("side-bar-open")) closeSideBar();
      setReloadStage("1");
      const minimumDisplay = document.documentElement.hasAttribute("data-mobile-timeline")
        ? waitForLaunchStage() : Promise.resolve();
      let error = "";
      try {
        const stateResponse = await fetch("/timeline-state", { cache: "no-store" });
        if (!stateResponse.ok) throw new Error(`HTTP ${stateResponse.status}`);
        const current = await stateResponse.json();
        if (current.server_instance === SERVER_INSTANCE_SEED) {
          const response = await fetch("/reload-timeline", { method: "POST", cache: "no-store" });
          if (!response.ok) {
            error = response.headers.get("Content-Type")?.includes("json")
              ? (await response.json()).error
              : await response.text();
          }
        }
      } catch (err) {
        error = err.message;
      }
      if (error) {
        reloadInFlight = false;
        setReloadStage("error");
        setError("Reload failed", error);
        return;
      }
      await minimumDisplay;
      const params = new URLSearchParams(window.location.search);
      params.set("ts", String(Date.now()));
      if (document.documentElement.hasAttribute("data-mobile-timeline")) setReloadStage("rendering");
      window.location.replace(`${window.location.pathname}?${params.toString()}`);
    };

    const mergeRefreshOptions = (current = {}, next = {}) => {
      const currentOptions = current || {};
      const nextOptions = next || {};
      return {
        forceScroll: !!(currentOptions.forceScroll || nextOptions.forceScroll),
        forceFullRender: !!(currentOptions.forceFullRender || nextOptions.forceFullRender),
        suppressEntryAnimation: !!(currentOptions.suppressEntryAnimation || nextOptions.suppressEntryAnimation),
      };
    };
    const rerenderCurrentMessages = ({ suppressEntryAnimation = false } = {}) => {
      if (!latestPayloadData) return;
      lastMessagesSig = "";
      render(latestPayloadData, { forceFullRender: true, suppressEntryAnimation });
    };
