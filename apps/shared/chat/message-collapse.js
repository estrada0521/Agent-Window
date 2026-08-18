    let selectedTargets = [];
    let sendLocked = false;
    let sessionActive = true;
    const canComposeInSession = () => !!sessionActive;
    let pendingAttachments = [];
    let availableTargets = [];
    let currentSessionName = "";
    let _renderedIds = new Set();
    const MESSAGE_COLLAPSE_LINES = 40;
    const expandedMessageBodies = new Set();
    const isCollapsibleMessageSender = (sender) => {
      const normalized = String(sender || "").trim().toLowerCase();
      return !!normalized && normalized !== "system";
    };
    const isCollapsibleMessageRow = (row) =>
      !!(row && row.classList?.contains("message-row") && isCollapsibleMessageSender(row.dataset?.sender));
    const syncMessageCollapse = (scope = document) => {
      const rows = scope?.matches?.("article.message-row")
        ? (isCollapsibleMessageRow(scope) ? [scope] : [])
        : Array.from(scope?.querySelectorAll?.("article.message-row") || []).filter(isCollapsibleMessageRow);
      rows.forEach((row) => {
        const bodyRow = row.querySelector(".message-body-row");
        const body = row.querySelector(".md-body");
        const toggle = row.querySelector(".message-collapse-toggle");
        if (!bodyRow || !body || !toggle) return;
        const style = getComputedStyle(body);
        const lineHeight = Number.parseFloat(style.lineHeight);
        const paddingTop = Number.parseFloat(style.paddingTop) || 0;
        const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
        if (!Number.isFinite(lineHeight)) {
          bodyRow.style.removeProperty("--message-collapse-max-height");
          row.classList.remove("is-collapsible");
          bodyRow.classList.remove("is-collapsed");
          toggle.classList.remove("is-visible");
          toggle.hidden = true;
          return;
        }
        const maxHeight = Math.ceil((lineHeight * MESSAGE_COLLAPSE_LINES) + paddingTop + paddingBottom);
        bodyRow.style.setProperty("--message-collapse-max-height", `${maxHeight}px`);
        const bodyWidth = Math.round(body.getBoundingClientRect().width || bodyRow.clientWidth || 0);
        if (bodyWidth < 40) {
          row.classList.remove("is-collapsible");
          bodyRow.classList.remove("is-collapsed");
          toggle.classList.remove("is-visible");
          toggle.hidden = true;
          const retries = Math.max(0, parseInt(row.dataset.collapseRetry || "0", 10) || 0);
          if (retries < 3) {
            row.dataset.collapseRetry = String(retries + 1);
            requestAnimationFrame(() => requestAnimationFrame(() => syncMessageCollapse(row)));
          } else {
            row.dataset.collapseRetry = "0";
          }
          return;
        }
        row.dataset.collapseRetry = "0";
        const shouldCollapse = body.scrollHeight > (maxHeight + 4);
        const msgId = row.dataset.msgid || "";
        const isExpanded = shouldCollapse && msgId && expandedMessageBodies.has(msgId);
        row.classList.toggle("is-collapsible", shouldCollapse);
        bodyRow.classList.toggle("is-collapsed", shouldCollapse && !isExpanded);
        const showMoreBtn = shouldCollapse && !isExpanded;
        toggle.classList.toggle("is-visible", showMoreBtn);
        toggle.hidden = !showMoreBtn;
        toggle.textContent = "More";
      });
    };
    const escapeHtml = (value) => value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    const emptyConversationHTML = () => {
      return `<div class="conversation-empty" aria-hidden="true"></div>`;
    };
    const stripSenderPrefix = (value) => value.replace(/^\[From:\s*[^\]]+\]\s*/i, "");
    const normalizedSessionTargets = (rawTargets) => {
      return Array.isArray(rawTargets)
        ? rawTargets.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
        : [];
    };
