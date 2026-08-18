    let currentAgentStatuses = {};
    let currentAgentRuntime = {};
    let thinkingRuntimeItems = {};
    const clearThinkingRuntimeItemTimers = (item) => {
      if (!item) return;
      clearTimeout(item.enterTimer);
      item.enterTimer = 0;
    };
    const currentThinkingRuntimeItem = (agent) => thinkingRuntimeItems[agent] || null;
    const clearThinkingRuntimeAgent = (agent, { suppressRender = false } = {}) => {
      const item = thinkingRuntimeItems[agent];
      if (!item) return false;
      clearThinkingRuntimeItemTimers(item);
      delete thinkingRuntimeItems[agent];
      if (!suppressRender) renderThinkingIndicator();
      return true;
    };
    const setThinkingRuntimeItem = (agent, event, { suppressRender = false } = {}) => {
      const entry = {
        id: String(event?.id || "").trim(),
        text: String(event?.text || "").trim(),
        phase: "live",
        enterTimer: 0,
        updatedAt: Number.isFinite(Number(event?.updatedAt)) && Number(event.updatedAt) > 0
          ? Number(event.updatedAt)
          : Date.now(),
      };
      if (!entry.id || !entry.text) return false;
      const current = currentThinkingRuntimeItem(agent);
      if (current && current.id === entry.id && current.text === entry.text) return false;
      clearThinkingRuntimeItemTimers(current);
      thinkingRuntimeItems[agent] = entry;
      if (!suppressRender) renderThinkingIndicator();
      return true;
    };
    const syncThinkingRuntimeItems = (statuses, { suppressRender = false } = {}) => {
      const runningAgents = new Set(
        Object.entries(statuses || {})
          .filter(([, status]) => status === "running")
          .map(([agent]) => agent)
      );
      let changed = false;
      Object.keys(thinkingRuntimeItems).forEach((agent) => {
        if (runningAgents.has(agent)) return;
        changed = clearThinkingRuntimeAgent(agent, { suppressRender: true }) || changed;
      });
      runningAgents.forEach((agent) => {
        const payload = currentAgentRuntime?.[agent];
        const raw = payload?.current_event;
        const id = String(raw?.id || "").trim();
        const text = String(raw?.text || "").trim();
        if (!id || !text) {
          changed = clearThinkingRuntimeAgent(agent, { suppressRender: true }) || changed;
        } else {
          changed = setThinkingRuntimeItem(agent, { id, text }, { suppressRender: true }) || changed;
        }
      });
      if (changed && !suppressRender) {
        renderThinkingIndicator();
      }
    };
    const wrapThinkingChars = (text, offset = 0) => {
      return Array.from(String(text || "")).map((ch, i) =>
        `<span class="thinking-char" style="--char-i:${i + offset}">${escapeHtml(ch)}</span>`
      ).join("");
    };
    const buildThinkingRuntimeHtml = (text) => {
      const raw = String(text || "").replace(/\r\n?/g, "\n");
      if (!raw) return "";
      const lines = raw.split("\n");
      const firstLine = lines.find((line) => line.trim().length > 0) ?? lines[0] ?? "";
      const cleanedLine = firstLine.replace(/^[⏺●•·◦○]\s+/, "").trim();
      const asciiToken = cleanedLine.match(/^([A-Za-z][A-Za-z0-9_.:-]*)([\s\S]*)$/);
      if (asciiToken) {
        const keyword = String(asciiToken[1] || "");
        const rest = String(asciiToken[2] || "");
        const trimmedRest = rest.trim();
        const tokenLooksStructured = /[._:]/.test(keyword);
        const detailText = trimmedRest ? (tokenLooksStructured ? ` ${cleanedLine}` : rest) : "";
        const detail = detailText
          ? `<span class="message-thinking-runtime-detail">${escapeHtml(detailText)}</span>`
          : "";
        return `<span class="message-thinking-runtime-keyword">${wrapThinkingChars(keyword)}</span>${detail}`;
      }
      const leading = cleanedLine.match(/^(\S+)([\s\S]*)$/);
      if (leading) {
        const keyword = String(leading[1] || "");
        const rest = String(leading[2] || "");
        const detail = rest ? `<span class="message-thinking-runtime-detail">${escapeHtml(rest)}</span>` : "";
        return `<span class="message-thinking-runtime-keyword">${wrapThinkingChars(keyword)}</span>${detail}`;
      }
      return escapeHtml(cleanedLine || firstLine);
    };
    const buildThinkingRuntimeLineInnerHtml = (contentHtml) => {
      return `<span class="message-thinking-runtime-body">${contentHtml}</span>`;
    };
    const syncThinkingRuntimeSlot = (label, { contentHtml, eventId = "" }) => {
      if (!label) return;
      let slot = label.querySelector(".message-thinking-runtime-slot");
      if (!slot) {
        slot = document.createElement("span");
        slot.className = "message-thinking-runtime-slot";
        label.appendChild(slot);
      }
      const stableId = String(eventId || "");
      const lines = Array.from(slot.querySelectorAll(".message-thinking-runtime-line"));
      const activeLine = lines.find((line) => String(line.dataset.state || "") !== "leave") || lines[lines.length - 1] || null;
      const activeBody = activeLine?.querySelector(".message-thinking-runtime-body");
      const activeHtml = activeBody ? activeBody.innerHTML : "";
      const sameText = !!activeLine && activeHtml === contentHtml;
      const sameId = !!activeLine && String(activeLine.dataset.eventId || "") === stableId;

      if (activeLine && sameText && sameId) {
        activeLine.dataset.state = "live";
        return;
      }

      if (activeLine) {
        if (activeLine._runtimeStateTimer) {
          clearTimeout(activeLine._runtimeStateTimer);
          activeLine._runtimeStateTimer = 0;
        }
        if (activeLine._runtimeRemoveTimer) {
          clearTimeout(activeLine._runtimeRemoveTimer);
          activeLine._runtimeRemoveTimer = 0;
        }
        activeLine.dataset.state = "leave";
        const lineToRemove = activeLine;
        lineToRemove._runtimeRemoveTimer = setTimeout(() => {
          lineToRemove.remove();
        }, 300);
      }

      const nextLine = document.createElement("span");
      nextLine.className = "message-thinking-runtime-line";
      nextLine.dataset.state = "enter";
      nextLine.dataset.eventId = stableId;
      nextLine.innerHTML = buildThinkingRuntimeLineInnerHtml(contentHtml);
      slot.appendChild(nextLine);

      // Use double requestAnimationFrame to guarantee layout transition triggers,
      // even if the element/container is currently detached or hidden during sync.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (nextLine.dataset.state === "enter") {
            nextLine.dataset.state = "live";
          }
        });
      });

      const allLines = Array.from(slot.querySelectorAll(".message-thinking-runtime-line"));
      if (allLines.length > 2) {
        allLines.slice(0, allLines.length - 2).forEach((line) => {
          if (line._runtimeStateTimer) {
            clearTimeout(line._runtimeStateTimer);
            line._runtimeStateTimer = 0;
          }
          if (line._runtimeRemoveTimer) {
            clearTimeout(line._runtimeRemoveTimer);
            line._runtimeRemoveTimer = 0;
          }
          line.remove();
        });
      }
    };
    let thinkingFloatingIconFrame = 0;
    const animateScrollButtonContentSwap = (button, apply) => {
      if (!button || typeof apply !== "function") return;
      if (button.dataset.swapState === "1") return;
      button.dataset.swapState = "1";
      button.classList.add("thinking-scroll-btn-swapping");
      setTimeout(() => {
        apply();
        requestAnimationFrame(() => {
          button.classList.remove("thinking-scroll-btn-swapping");
          delete button.dataset.swapState;
        });
      }, 80);
    };
    const restoreThinkingScrollButton = () => {
      const button = document.getElementById("scrollToBottomBtn");
      if (!button || !button.classList.contains("thinking-scroll-btn")) return;
      animateScrollButtonContentSwap(button, () => {
        const defaultHtml = button.dataset.defaultHtml || "";
        if (defaultHtml) button.innerHTML = defaultHtml;
        button.classList.remove("thinking-scroll-btn");
        button.removeAttribute("data-thinking-sig");
        button.setAttribute("aria-label", "Scroll to bottom");
        button.setAttribute("title", "Scroll to bottom");
      });
    };
    const removeThinkingFloatingIcons = () => {
      if (thinkingFloatingIconFrame) {
        cancelAnimationFrame(thinkingFloatingIconFrame);
        thinkingFloatingIconFrame = 0;
      }
      restoreThinkingScrollButton();
    };
    const syncThinkingFloatingIcons = () => {
      thinkingFloatingIconFrame = 0;
      const root = document.getElementById("messages");
      const container = root?.querySelector(".message-thinking-container");
      if (!root || !timeline || !container || !document.body?.classList.contains("agent-runtime-running")) {
        removeThinkingFloatingIcons();
        return;
      }
      const sources = Array.from(container.querySelectorAll(".message-thinking-row"))
        .map((row) => {
          const wrap = row.querySelector(".message-thinking-icon-wrap");
          return wrap ? { row, wrap } : null;
        })
        .filter(Boolean);
      if (!sources.length) {
        removeThinkingFloatingIcons();
        return;
      }

      const visibleSources = sources.slice(0, 1);
      const sig = visibleSources.map(({ row, wrap }) => {
        const icon = wrap.querySelector(".message-thinking-icon");
        return [
          row.dataset.agent || "",
          row.style.getPropertyValue("--agent-pulse-delay") || "",
          icon?.className || "",
          icon?.getAttribute("style") || "",
        ].join(":");
      }).join("|");

      const sourceAnchor = sources[0].wrap.closest(".message-thinking-icons") || sources[0].wrap;
      const sourceRect = sourceAnchor.getBoundingClientRect();
      const timelineRect = timeline.getBoundingClientRect();
      if (!sourceRect.width || !sourceRect.height || !timelineRect.width || !timelineRect.height) {
        restoreThinkingScrollButton();
        return;
      }
      const bottomInset = 14;
      const expectedHeight = Math.max(24, sourceRect.height);
      const stickyTop = timelineRect.bottom - bottomInset - expectedHeight;
      const shouldStick = sourceRect.top > stickyTop || sourceRect.bottom < timelineRect.top;
      if (!shouldStick || _stickyToBottom) {
        restoreThinkingScrollButton();
        return;
      }

      const button = document.getElementById("scrollToBottomBtn");
      if (!button) return;
      if (!button.dataset.defaultHtml) button.dataset.defaultHtml = button.innerHTML;
      const buttonSig = `scroll:${sig}`;
      if (button.getAttribute("data-thinking-sig") !== buttonSig) {
        animateScrollButtonContentSwap(button, () => {
          button.setAttribute("data-thinking-sig", buttonSig);
          button.innerHTML = "";
          visibleSources.forEach(({ row, wrap }) => {
            const clone = wrap.cloneNode(true);
            clone.classList.add("message-thinking-floating-icon-wrap");
            clone.style.setProperty("--agent-pulse-delay", row.style.getPropertyValue("--agent-pulse-delay") || "0s");
            button.appendChild(clone);
          });
          button.classList.add("thinking-scroll-btn");
          button.setAttribute("aria-label", "Scroll to bottom");
          button.setAttribute("title", "Scroll to bottom");
        });
        return;
      }
      button.classList.add("thinking-scroll-btn");
      button.setAttribute("aria-label", "Scroll to bottom");
      button.setAttribute("title", "Scroll to bottom");
    };
    const scheduleThinkingFloatingIcons = () => {
      if (thinkingFloatingIconFrame) return;
      thinkingFloatingIconFrame = requestAnimationFrame(syncThinkingFloatingIcons);
    };
    const renderThinkingIndicator = () => {
      const root = document.getElementById("messages");
      if (!root) {
        document.body?.classList.remove("agent-runtime-running");
        removeThinkingFloatingIcons();
        return;
      }
      const runningAgents = Object.keys(currentAgentStatuses).filter((agent) => currentAgentStatuses[agent] === "running");
      const hasRuntimeRunning = runningAgents.length > 0;
      document.body?.classList.toggle("agent-runtime-running", hasRuntimeRunning);
      const existingContainer = root.querySelector(".message-thinking-container");

      if (!root.querySelector("article.message-row") || !hasRuntimeRunning) {
        if (existingContainer) existingContainer.remove();
        root.dataset.thinkingSig = "";
        removeThinkingFloatingIcons();
        maybeRestorePollScrollLock();
        return;
      }

      const agentRuntimeSig = JSON.stringify(
        runningAgents.map((agent) => [
          agent,
          currentThinkingRuntimeItem(agent)
            ? [currentThinkingRuntimeItem(agent).id, currentThinkingRuntimeItem(agent).text, currentThinkingRuntimeItem(agent).phase]
            : null,
        ])
      );
      const nextThinkingSig = `${runningAgents.join(",")}|${agentRuntimeSig}`;
      if (root.dataset.thinkingSig === nextThinkingSig && existingContainer) {
        if (root.lastElementChild !== existingContainer) {
          root.appendChild(existingContainer);
        }
        scheduleThinkingFloatingIcons();
        return;
      }

      const container = existingContainer || document.createElement("div");
      container.className = "message-thinking-container";

      const ensureAgentRow = (agent) => {
        let row = Array.from(container.querySelectorAll(".message-thinking-row[data-agent]"))
          .find((node) => node.dataset.agent === agent);
        const pulse = agentPulseOffset(agent);
        if (!row) {
          row = document.createElement("div");
          row.className = "message-thinking-row";
          row.dataset.agent = agent;
          row.innerHTML = `
            <span class="message-thinking-icons">
              <span class="message-thinking-icon-wrap">
                <span class="message-thinking-glow"></span>
                ${thinkingIconImg(agent, `message-thinking-icon message-thinking-icon--${agentBaseName(agent)}`)}
              </span>
            </span>
            <span class="message-thinking-label message-thinking-label-agent"></span>
          `;
        }
        row.style.setProperty("--agent-pulse-delay", `${pulse}s`);
        const runtimeItem = currentThinkingRuntimeItem(agent);
        const label = row.querySelector(".message-thinking-label-agent");

        const nextText = runtimeItem ? buildThinkingRuntimeHtml(runtimeItem.text) : `<span class="message-thinking-runtime-keyword">${wrapThinkingChars("Running...")}</span>`;
        const nextId = runtimeItem ? (String(runtimeItem.id || "")) : "generic";
        if (label) {
          syncThinkingRuntimeSlot(label, {
            contentHtml: nextText,
            eventId: nextId,
          });
        }
        return row;
      };

      const desiredAgents = new Set(runningAgents);
      container.querySelectorAll(".message-thinking-row[data-agent]").forEach((row) => {
        if (!desiredAgents.has(row.dataset.agent || "")) {
          row.remove();
        }
      });

      runningAgents.forEach((agent) => {
        container.appendChild(ensureAgentRow(agent));
      });
      if (root.lastElementChild !== container) {
        root.appendChild(container);
      }
      root.dataset.thinkingSig = nextThinkingSig;
      scheduleThinkingFloatingIcons();
      maybeRestorePollScrollLock();
    };
    timeline?.addEventListener("scroll", scheduleThinkingFloatingIcons, { passive: true });
    window.addEventListener("resize", scheduleThinkingFloatingIcons, { passive: true });
    if (document.documentElement.dataset.mobile !== "1") {
      timeline?.addEventListener("click", (event) => {
        const wrap = event.target.closest(".message-thinking-icon-wrap");
        if (!wrap) return;
        const row = wrap.closest(".message-thinking-row[data-agent]");
        if (!row) return;
        const agent = row.dataset.agent || "";
        if (!agent) return;
        fetch("/open-terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent }),
        }).catch(() => {});
      });
    }
