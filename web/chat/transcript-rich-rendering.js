    let katexLoadPromise = null;
    const scopeNeedsMathRender = (node) => !!node?.querySelector?.(".math-render-needed");
    const clearMathMarkers = (node) => {
      node?.querySelectorAll?.(".math-render-needed").forEach((marker) => marker.remove());
    };
    const ensureKatexReady = async () => {
      if (typeof renderMathInElement === "function") return true;
      if (katexLoadPromise) return katexLoadPromise;
      katexLoadPromise = (async () => {
        const cssReady = await loadExternalStylesheetOnce(KATEX_CSS_HREF);
        const katexReady = await loadExternalScriptOnce(KATEX_JS_SRC);
        const autoRenderReady = katexReady ? await loadExternalScriptOnce(KATEX_AUTO_RENDER_SRC) : false;
        return cssReady && katexReady && autoRenderReady && typeof renderMathInElement === "function";
      })().catch(() => false);
      return katexLoadPromise;
    };
    const renderMathInScope = (node) => {
      if (!node || !scopeNeedsMathRender(node)) return;
      const applyMath = () => {
        if (typeof renderMathInElement === "undefined") return;
        renderMathInElement(node, mathRenderOptions);
        clearMathMarkers(node);
        if (typeof syncWideBlockRows === "function") syncWideBlockRows(node);
        if (typeof syncMessageCollapse === "function") syncMessageCollapse(node);
      };
      if (typeof renderMathInElement === "function") {
        applyMath();
        return;
      }
      ensureKatexReady().then((ready) => {
        if (ready) applyMath();
      });
    };
    const ensureWideTables = (scope = document) => {
      scope.querySelectorAll(".md-body table").forEach((table) => {
        if (table.closest(".table-scroll")) return;
        const parent = table.parentNode;
        if (!parent) return;
        const scroll = document.createElement("div");
        scroll.className = "table-scroll";
        parent.insertBefore(scroll, table);
        scroll.appendChild(table);
      });
    };
    const syncWideBlockRows = (scope = document) => {
      ensureWideTables(scope);
      scope.querySelectorAll(".message-body-row").forEach((row) => {
        const body = row.querySelector(".md-body");
        const hasStructuredBlock = !!body?.querySelector("ul, ol, blockquote, pre, .table-scroll, .katex-display");
        row.classList.toggle("has-structured-block", hasStructuredBlock);
      });
    };
    let stableCodeBlocksRaf = 0;
    const stableCodeBlockScopes = new Set();
    const queueStableCodeBlockSync = (scope = document) => {
      if (scope) stableCodeBlockScopes.add(scope);
      if (stableCodeBlocksRaf) return;
      stableCodeBlocksRaf = requestAnimationFrame(() => {
        stableCodeBlocksRaf = 0;
        const scopes = Array.from(stableCodeBlockScopes);
        stableCodeBlockScopes.clear();
        const seen = new Set();
        const pres = [];
        scopes.forEach((target) => {
          if (!target) return;
          const list = target?.matches?.(".md-body pre")
            ? [target]
            : Array.from(target.querySelectorAll?.(".md-body pre") || []);
          list.forEach((pre) => {
            if (!pre || !pre.isConnected || seen.has(pre)) return;
            seen.add(pre);
            pres.push(pre);
          });
        });
        pres.forEach((pre) => {
          const width = pre.clientWidth || 0;
          const prevWidth = Number.parseFloat(pre.dataset.stableWidth || "0");
          const widthChanged = Math.abs(width - prevWidth) > 0.5;
          if (widthChanged) {
            pre.style.removeProperty("--code-scroll-stable-height");
          }
          const hasHorizontalScroll = (pre.scrollWidth - pre.clientWidth) > 1;
          if (hasHorizontalScroll) {
            pre.style.setProperty("--code-scroll-stable-height", `${pre.offsetHeight}px`);
            pre.dataset.stableWidth = String(width);
            pre.dataset.stableCodeScroll = "1";
          } else if (widthChanged || pre.dataset.stableCodeScroll === "1") {
            pre.style.removeProperty("--code-scroll-stable-height");
            pre.dataset.stableWidth = String(width);
            delete pre.dataset.stableCodeScroll;
          } else {
            pre.dataset.stableWidth = String(width);
          }
        });
      });
    };
    updateScrollBtnPos();
    window.addEventListener("resize", () => {
      syncWideBlockRows(document);
      queueStableCodeBlockSync(document);
      syncMessageCollapse(document);
    });
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        syncWideBlockRows(document);
        queueStableCodeBlockSync(document);
        syncMessageCollapse(document);
      }).catch(() => {});
    }
    const AGENT_ICON_NAMES = __AGENT_ICON_NAMES_JS_SET__;
    const ALL_BASE_AGENTS = __ALL_BASE_AGENTS_JS_ARRAY__;
    const agentBaseName = (name) => (name || "").toLowerCase().replace(/-\d+$/, "");
    const agentIconInstanceSubDigits = (name) => {
      const m = String(name || "").toLowerCase().match(/-(\d+)$/);
      return m ? m[1] : "";
    };
    const agentIconInstanceSubHtml = (name) => {
      const d = agentIconInstanceSubDigits(name);
      return d ? `<span class="agent-icon-instance-sub" aria-hidden="true">${escapeHtml(d)}</span>` : "";
    };
    const roleClass = (sender) => {
      const base = agentBaseName(sender);
      if (base === "user" || AGENT_ICON_NAMES.has(base)) return base;
      return "agent";
    };
    const agentIconSrc = (name) => {
      const raw = String(name || "").trim();
      if (!raw) return `${CHAT_ASSET_BASE}/icon/`;
      const base = agentBaseName(raw);
      const enc = encodeURIComponent(raw.toLowerCase());
      if (AGENT_ICON_DATA[base]) return AGENT_ICON_DATA[base];
      return `${CHAT_ASSET_BASE}/icon/${enc}`;
    };
    const agentPulseOffset = () => 0;
    const paneViewerTabIconHtml = (agent) => {
      const iconUrl = agentIconSrc(agent);
      const sub = agentIconInstanceSubHtml(agent);
      return `<span class="agent-icon-slot agent-icon-slot--pane-tab"><span class="pane-viewer-tab-icon" aria-hidden="true" style="--agent-icon-mask:url('${escapeHtml(iconUrl)}')"></span>${sub}</span>`;
    };
    const thinkingIconImg = (name, cls) => {
      const base = agentBaseName(name);
      if (!AGENT_ICON_NAMES.has(base)) return "";
      const sub = agentIconInstanceSubHtml(name);
      return `<span class="agent-icon-slot agent-icon-slot--thinking"><span class="${cls}" aria-hidden="true" style="--agent-icon-mask:url('${escapeHtml(agentIconSrc(name))}')"></span>${sub}</span>`;
    };
    const entryQualifiesForStreamReveal = (entry) => {
      const s = String(entry?.sender || "").trim().toLowerCase();
      return s !== "" && s !== "user" && s !== "system";
    };
    const STREAM_REVEAL_SKIP_SEL = ".katex, .katex-display, table, .table-scroll, script, style";
    const STREAM_REVEAL_ANIM_MS = 21;
    const STREAM_REVEAL_STEP_MS = 8;
    const STREAM_REVEAL_MAX_MS = 750;
    const streamGraphemeSegmenter = typeof Intl !== "undefined" && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
    const streamTextUnits = (text) => {
      const raw = String(text || "");
      if (!raw) return [];
      if (streamGraphemeSegmenter) {
        try {
          return Array.from(streamGraphemeSegmenter.segment(raw), (part) => part.segment);
        } catch (_) {}
      }
      return Array.from(raw);
    };
    const unwrapStreamRevealSpans = (row) => {
      if (!row) return;
      row.querySelectorAll(".md-body").forEach((md) => {
        md.querySelectorAll(".stream-reveal-chunk").forEach((span) => {
          span.replaceWith(document.createTextNode(span.textContent));
        });
        try { md.normalize(); } catch (_) {}
        md.style.removeProperty("--stream-reveal-delay");
        delete md.dataset.streamRevealApplied;
      });
    };
    const applyStreamRevealToRow = (row) => {
      const mdBody = row?.querySelector?.(".md-body");
      if (!mdBody || mdBody.dataset.streamRevealApplied) return;
      if (scopeNeedsMathRender(mdBody)) {
        mdBody.dataset.streamRevealApplied = "1";
        row._streamRevealTotalMs = 0;
        return;
      }
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        mdBody.dataset.streamRevealApplied = "1";
        row._streamRevealTotalMs = 0;
        return;
      }
      const textNodes = [];
      let totalUnits = 0;
      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.nodeValue;
          const parentEl = node.parentElement;
          if (!text || !/\S/.test(text) || !parentEl || parentEl.closest(STREAM_REVEAL_SKIP_SEL)) return;
          const units = streamTextUnits(text);
          if (!units.length) return;
          textNodes.push({ node, units });
          totalUnits += units.length;
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches(STREAM_REVEAL_SKIP_SEL)) return;
        Array.from(node.childNodes).forEach(walk);
      };
      walk(mdBody);
      mdBody.dataset.streamRevealApplied = "1";
      if (!totalUnits) {
        row._streamRevealTotalMs = 0;
        return;
      }
      const totalDuration = Math.min(totalUnits * STREAM_REVEAL_STEP_MS, STREAM_REVEAL_MAX_MS);
      const revealSteps = Math.min(totalUnits, Math.ceil(totalDuration / STREAM_REVEAL_STEP_MS));
      let globalIndex = 0;
      for (const { node, units } of textNodes) {
        const frag = document.createDocumentFragment();
        let localIndex = 0;
        while (localIndex < units.length) {
          const step = Math.min(revealSteps - 1, Math.floor(globalIndex * revealSteps / totalUnits));
          const nextStepAt = Math.ceil((step + 1) * totalUnits / revealSteps);
          const take = Math.max(1, Math.min(units.length - localIndex, nextStepAt - globalIndex));
          const span = document.createElement("span");
          span.className = "stream-reveal-chunk";
          span.textContent = units.slice(localIndex, localIndex + take).join("");
          span.style.setProperty("--stream-reveal-step", String(step));
          frag.appendChild(span);
          localIndex += take;
          globalIndex += take;
        }
        node.parentNode.replaceChild(frag, node);
      }
      const stepDelay = totalDuration / revealSteps;
      mdBody.style.setProperty("--stream-reveal-delay", stepDelay + "ms");
      row._streamRevealTotalMs = totalDuration + STREAM_REVEAL_ANIM_MS + 80;
    };
    const metaAgentLabel = (name, textClass, iconSide = "right", { iconOnly = false } = {}) => {
      const raw = (name || "").trim() || "unknown";
      const base = agentBaseName(raw);
      const hasIcon = AGENT_ICON_NAMES.has(base);
      const icon = hasIcon
        ? `<span class="agent-icon-slot agent-icon-slot--meta"><span class="meta-agent-icon" aria-hidden="true" style="--agent-icon-mask:url('${escapeHtml(agentIconSrc(raw))}')"></span>${agentIconInstanceSubHtml(raw)}</span>`
        : iconOnly
          ? `<span class="agent-icon-slot agent-icon-slot--meta meta-agent-fallback" aria-hidden="true">—</span>`
          : "";
      const sideClass = iconSide === "right" ? " icon-right" : "";
      const titleAttr = ` title="${escapeHtml(raw).replaceAll('"', "&quot;")}"`;
      const labelAttr = iconOnly ? ` aria-label="${escapeHtml(raw).replaceAll('"', "&quot;")}"` : "";
      if (iconOnly) {
        return `<span class="meta-agent meta-agent--icon-only${sideClass}"${titleAttr}${labelAttr}>${icon}</span>`;
      }
      return `<span class="meta-agent${sideClass}">${icon}<span class="${textClass}">${escapeHtml(raw)}</span></span>`;
    };
