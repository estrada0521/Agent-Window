    let lastMessagesSig = "";
    let lastMessagesEtag = "";
    let initialLoadDone = false;
    const copyIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const checkIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
    const postRenderScope = (scope) => {
      decorateLocalFileLinks(scope);
      linkifyInlineCodeFileRefs(scope);
      renderMathInScope(scope);
      syncWideBlockRows(scope);
      syncMessageCollapse(scope);
      observeDeferredMessages(scope);
    };
    const overrideDisplayEntry = (entry) => {
      const msgId = String(entry?.msg_id || "");
      return (msgId && publicFullEntryCache.get(msgId)) || entry;
    };
__CHAT_INCLUDE:../messages-data.js__
    const buildMsgHTML = (entry, options = {}) => {
        const safeEntry = (entry && typeof entry === "object") ? entry : {};
        if (safeEntry.sender === "system") {
          const kindRaw = String(safeEntry.kind || "");
          const systemMessage = emphasizeSystemMessageKeyword(escapeHtml(safeEntry.message || ""), kindRaw);
          const systemTitle = systemMessage.replaceAll('"', "&quot;").replace(/<[^>]+>/g, "");
          const msgId = escapeHtml(safeEntry.msg_id || "");
          const isSessionLifecycle = /^(?:Session archived|Session revived)\b/i.test(safeEntry.message || "");
          const extraClass = isSessionLifecycle ? " sysmsg-strong" : "";
          return `<div class="sysmsg-row${extraClass}" data-msgid="${msgId}" data-sender="system"><span class="sysmsg-text" title="${systemTitle}">${systemMessage}</span></div>`;
        }
        const cls = roleClass(safeEntry.sender);
        const entryTargets = Array.isArray(safeEntry.targets) ? safeEntry.targets : [];
        const targetIconOnly = (t) => agentBaseName(t) !== "user";
        const targetSpans = (entryTargets.length > 0
          ? entryTargets.map(t => metaAgentLabel(t, "target-name", "right", { iconOnly: targetIconOnly(t) }))
          : [metaAgentLabel("no target", "target-name", "right", { iconOnly: true })]).join(`<span class="meta-agent-sep">,</span>`);
        const body = stripSenderPrefix(safeEntry.message || "");
        const rawAttr = escapeHtml(body).replaceAll('"', "&quot;");
        const previewAttr = escapeHtml(body.slice(0, 80)).replaceAll('"', "&quot;");
        const msgId = escapeHtml(safeEntry.msg_id || "");
        const targetMeta = `<span class="targets">${targetSpans}</span>`;
        const sender = escapeHtml(safeEntry.sender || "unknown");
        const isUser = cls === "user";
        const isCollapsibleMessage = isCollapsibleMessageSender(safeEntry.sender);
        const hideMetaRow = !!options.hideMetaRow;
        const metaHiddenClass = hideMetaRow ? " meta-hidden" : "";
        const isMobile = document.documentElement.dataset.mobile === "1";
        const copyButtonHtml = (extraClass = "") => `<button class="copy-btn${extraClass}" type="button" title="コピー" aria-label="コピー" data-copy-icon="${escapeHtml(copyIcon).replaceAll('"', "&quot;")}" data-check-icon="${escapeHtml(checkIcon).replaceAll('"', "&quot;")}">${copyIcon}</button>`;
        const messageBodyHtml = `<div class="md-body">${renderMarkdown(body)}</div>`;
        const senderHtml = metaAgentLabel(safeEntry.sender || "unknown", "sender-label", "right", { iconOnly: true });
        const metaRowHtml = hideMetaRow
          ? ""
          : (isUser
            ? `<div class="message-meta-below user-message-meta"><span class="arrow">to</span>${targetMeta}${isMobile ? copyButtonHtml() : ""}</div>`
            : `<div class="message-meta-below">${senderHtml}<span class="arrow">to</span>${targetMeta}${isMobile ? copyButtonHtml() : ""}</div>`);
        const hoverCopyHtml = isMobile ? "" : `<div class="message-hover-copy-zone">${copyButtonHtml(" message-hover-copy")}</div>`;
        const deferredBodyHtml = safeEntry.deferred_body && msgId
          ? `<div class="message-deferred-actions"><button class="message-deferred-btn" type="button" data-load-full-message="${msgId}">Load full message</button></div>`
          : "";

        return `<article class="message-row ${cls}${metaHiddenClass}" data-msgid="${msgId}" data-sender="${sender}">
        <div class="message ${cls}" data-raw="${rawAttr}" data-preview="${previewAttr}">
        ${metaRowHtml}
        <div class="message-body-row">
          ${messageBodyHtml}
          ${isCollapsibleMessage ? `<button class="message-collapse-toggle" type="button" hidden>More</button>` : ""}
          ${hoverCopyHtml}
        </div>
        ${deferredBodyHtml}
        ${isUser ? `<div class="user-message-divider" aria-hidden="true"></div>` : ``}
        </div>
      </article>`;
    };
    const updateSessionUI = (data, displayEntries) => {
      currentSessionName = data.session || "";
      if (document.documentElement.dataset.mobile === "1") repoSession = currentSessionName;
      sessionActive = !!data.active;
      const resolvedTargets = normalizedSessionTargets(data.targets);
      const picker = document.getElementById("targetPicker");
      if (!picker.dataset.loaded) {
        const restoredTargets = loadTargetSelection(currentSessionName, resolvedTargets);
        selectedTargets = restoredTargets.length ? restoredTargets : [];
        saveTargetSelection(currentSessionName, selectedTargets);
        picker.dataset.loaded = "1";
        renderAgentStatus(Object.fromEntries(resolvedTargets.map((t) => [t, "idle"])));
      }
      const nextTargetsSig = JSON.stringify(resolvedTargets);
      if (nextTargetsSig !== JSON.stringify(availableTargets)) {
        availableTargets = resolvedTargets;
        selectedTargets = selectedTargets.filter((target) => availableTargets.includes(target));
        saveTargetSelection(data.session, selectedTargets);
        renderTargetPicker(availableTargets);
      }
      document.getElementById("message").disabled = !sessionActive;
      setQuickActionsDisabled(!sessionActive);
      if (!sessionActive) {
        setStatus("archived session is read-only");
      }
      maybeAutoOpenComposer();
      if (document.documentElement.dataset.mobile === "1") {
        updateRepoPanel(displayEntries);
      } else {
        dpOnSessionSummaryPinReload();
      }
    };
    const scheduleAnimateInCleanup = (row, opts = {}) => {
      const streamBody = !!opts.streamBody;
      if (!row) return;
      const isUserRow = row.classList.contains("user");
      if (row._animateInCleanupTimer) {
        clearTimeout(row._animateInCleanupTimer);
        row._animateInCleanupTimer = 0;
      }
      let animateInDone = false;
      const finishAnimateIn = () => {
        if (animateInDone) return;
        animateInDone = true;
        row.classList.remove("animate-in");
      };
      const messageEl = row.querySelector(".message");
      if (messageEl) {
        messageEl.addEventListener("animationend", (event) => {
          if (event.target !== messageEl) return;
          if (!isUserRow || event.animationName !== "userMsgReveal") return;
          const divider = row.querySelector(".user-message-divider");
          if (!divider) finishAnimateIn();
        }, { once: true });
      }
      if (isUserRow) {
        const dividerEl = row.querySelector(".user-message-divider");
        dividerEl?.addEventListener("animationend", (event) => {
          if (event.target !== dividerEl) return;
          if (event.animationName !== "userDividerReveal") return;
          finishAnimateIn();
        }, { once: true });
      }
      row.addEventListener("animationend", (event) => {
        if (event.target !== row || event.animationName !== "msgReveal") return;
        finishAnimateIn();
      }, { once: true });
      row._animateInCleanupTimer = setTimeout(finishAnimateIn, 850);
      if (!streamBody) return;
      let streamDone = false;
      const finishStream = () => {
        if (streamDone) return;
        streamDone = true;
        row.classList.remove("streaming-body-reveal");
        delete row._streamRevealTotalMs;
        if (row.isConnected) linkifyInlineCodeFileRefsImmediate(row);
      };
      const ms = typeof row._streamRevealTotalMs === "number" ? row._streamRevealTotalMs : 1700;
      if (ms <= 0) {
        queueMicrotask(finishStream);
      } else {
        setTimeout(finishStream, ms);
      }
    };
