    let currentAgentStatuses = {};
    let currentRunningDisplay = {};
    let thinkingRunningItems = {};
    const clearThinkingRunningItemTimers = (item) => {
      if (!item) return;
      clearTimeout(item.enterTimer);
      item.enterTimer = 0;
    };
    const currentThinkingRunningItem = (agent) => thinkingRunningItems[agent] || null;
    const clearThinkingRunningAgent = (agent, { suppressRender = false } = {}) => {
      const item = thinkingRunningItems[agent];
      if (!item) return false;
      clearThinkingRunningItemTimers(item);
      delete thinkingRunningItems[agent];
      if (!suppressRender) renderThinkingIndicator();
      return true;
    };
    const setThinkingRunningItem = (agent, event, { suppressRender = false } = {}) => {
      const entry = {
        id: String(event?.id || "").trim(),
        keyword: String(event?.keyword || "").trim(),
        detail: String(event?.detail || "").trim(),
        phase: "live",
        enterTimer: 0,
        updatedAt: Number.isFinite(Number(event?.updatedAt)) && Number(event.updatedAt) > 0
          ? Number(event.updatedAt)
          : Date.now(),
      };
      if (!entry.id || !entry.keyword) return false;
      const current = currentThinkingRunningItem(agent);
      if (current && current.id === entry.id && current.keyword === entry.keyword && current.detail === entry.detail) return false;
      clearThinkingRunningItemTimers(current);
      thinkingRunningItems[agent] = entry;
      if (!suppressRender) renderThinkingIndicator();
      return true;
    };
    const syncThinkingRunningItems = (statuses, { suppressRender = false } = {}) => {
      const runningAgents = new Set(
        Object.entries(statuses || {})
          .filter(([, status]) => status === "running")
          .map(([agent]) => agent)
      );
      let changed = false;
      Object.keys(thinkingRunningItems).forEach((agent) => {
        if (runningAgents.has(agent)) return;
        changed = clearThinkingRunningAgent(agent, { suppressRender: true }) || changed;
      });
      runningAgents.forEach((agent) => {
        const payload = currentRunningDisplay?.[agent];
        const raw = payload?.current_event;
        const id = String(raw?.id || "").trim();
        const keyword = String(raw?.keyword || "").trim();
        const detail = String(raw?.detail || "").trim();
        if (!id || !keyword) {
          changed = clearThinkingRunningAgent(agent, { suppressRender: true }) || changed;
        } else {
          changed = setThinkingRunningItem(agent, { id, keyword, detail }, { suppressRender: true }) || changed;
        }
      });
      if (changed && !suppressRender) {
        renderThinkingIndicator();
      }
    };
    const buildThinkingRunningHtml = (keyword, detail = "") => {
      const detailHtml = detail
        ? `<span class="message-thinking-running-detail"> ${escapeHtml(detail)}</span>`
        : "";
      return `<span class="message-thinking-running-keyword">${escapeHtml(keyword)}</span>${detailHtml}`;
    };
    const buildThinkingRunningLineInnerHtml = (contentHtml) => {
      return `<span class="message-thinking-running-body">${contentHtml}</span>`;
    };
    const syncThinkingRunningSlot = (label, { contentHtml, eventId = "" }) => {
      if (!label) return;
      let slot = label.querySelector(".message-thinking-running-slot");
      if (!slot) {
        slot = document.createElement("span");
        slot.className = "message-thinking-running-slot";
        label.appendChild(slot);
      }
      const stableId = String(eventId || "");
      const lines = Array.from(slot.querySelectorAll(".message-thinking-running-line"));
      const lineMatches = (line) => {
        const body = line?.querySelector(".message-thinking-running-body");
        return !!line
          && (body ? body.innerHTML : "") === contentHtml
          && String(line.dataset.eventId || "") === stableId;
      };
      const pendingLine = lines.find((line) => line.dataset.state === "enter" && lineMatches(line));
      if (pendingLine) return;

      const activeLine = [...lines].reverse().find((line) => line.dataset.state === "live") || null;
      const activeBody = activeLine?.querySelector(".message-thinking-running-body");
      const activeHtml = activeBody ? activeBody.innerHTML : "";
      const sameText = !!activeLine && activeHtml === contentHtml;
      const sameId = !!activeLine && String(activeLine.dataset.eventId || "") === stableId;

      if (activeLine && sameText && sameId) {
        activeLine.dataset.state = "live";
        return;
      }

      lines.forEach((line) => {
        if (line === activeLine) return;
        if (line._runningRemoveTimer) {
          clearTimeout(line._runningRemoveTimer);
          line._runningRemoveTimer = 0;
        }
        line.dataset.state = "superseded";
        line.remove();
      });

      const nextLine = document.createElement("span");
      nextLine.className = "message-thinking-running-line";
      nextLine.dataset.state = lines.length ? "enter" : "live";
      nextLine.dataset.eventId = stableId;
      nextLine.innerHTML = buildThinkingRunningLineInnerHtml(contentHtml);
      slot.appendChild(nextLine);
      if (nextLine.dataset.state === "live") return;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!nextLine.isConnected || nextLine.dataset.state !== "enter") return;
          if (activeLine?.isConnected) {
            activeLine.dataset.state = "leave";
            const lineToRemove = activeLine;
            lineToRemove._runningRemoveTimer = setTimeout(() => {
              lineToRemove.remove();
            }, 300);
          }
          nextLine.dataset.state = "live";
        });
      });
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
      if (!root || !timeline || !container || !document.body?.classList.contains("agent-running")) {
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
            clone.removeAttribute("title");
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
    };
    const scheduleThinkingFloatingIcons = () => {
      if (thinkingFloatingIconFrame) return;
      thinkingFloatingIconFrame = requestAnimationFrame(syncThinkingFloatingIcons);
    };
    const renderThinkingIndicator = () => {
      const root = document.getElementById("messages");
      if (!root) {
        document.body?.classList.remove("agent-running");
        removeThinkingFloatingIcons();
        return;
      }
      const runningAgents = Object.keys(currentAgentStatuses).filter((agent) => currentAgentStatuses[agent] === "running");
      const hasRunningRunning = runningAgents.length > 0;
      document.body?.classList.toggle("agent-running", hasRunningRunning);
      const existingContainer = root.querySelector(".message-thinking-container");

      if (!root.querySelector("article.message-row") || !hasRunningRunning) {
        if (existingContainer) {
          existingContainer.remove();
          document.dispatchEvent(new CustomEvent("chat-thinking-updated"));
        }
        root.dataset.thinkingSig = "";
        removeThinkingFloatingIcons();
        maybeRestorePollScrollLock();
        return;
      }

      const agentRunningSig = JSON.stringify(
        runningAgents.map((agent) => [
          agent,
          currentThinkingRunningItem(agent)
            ? [currentThinkingRunningItem(agent).id, currentThinkingRunningItem(agent).keyword, currentThinkingRunningItem(agent).detail, currentThinkingRunningItem(agent).phase]
            : null,
        ])
      );
      const nextThinkingSig = `${runningAgents.join(",")}|${agentRunningSig}`;
      if (root.dataset.thinkingSig === nextThinkingSig && existingContainer) {
        if (root.lastElementChild !== existingContainer) {
          root.appendChild(existingContainer);
        }
        scheduleThinkingFloatingIcons();
        return;
      }

      const hadContainer = !!existingContainer;
      const prevRowCount = existingContainer
        ? existingContainer.querySelectorAll(".message-thinking-row[data-agent]").length
        : 0;
      const container = existingContainer || document.createElement("div");
      container.className = "message-thinking-container";

      const ensureAgentRow = (agent) => {
        let row = Array.from(container.querySelectorAll(".message-thinking-row[data-agent]"))
          .find((node) => node.dataset.agent === agent);
        const pulse = agentPulseOffset(agent);
        if (!row) {
          row = document.createElement("div");
          row.className = "message-thinking-row is-appearing";
          row.dataset.agent = agent;
          row.addEventListener("animationend", (event) => {
            if (event.target === row) row.classList.remove("is-appearing");
          });
          row.innerHTML = `
            <span class="message-thinking-icons">
              <span class="message-thinking-icon-wrap">
                <span class="message-thinking-glow"></span>
                ${thinkingIconImg(agent, `message-thinking-icon message-thinking-icon--${agentBaseName(agent)}`)}
              </span>
            </span>
            <span class="message-thinking-label message-thinking-label-agent"></span>
          `;
          if (document.documentElement.dataset.mobile !== "1") {
            row.querySelector(".message-thinking-icon-wrap").title = "Open Pane";
          }
        }
        const pulseDelay = `${pulse}s`;
        if (row.style.getPropertyValue("--agent-pulse-delay") !== pulseDelay) {
          row.style.setProperty("--agent-pulse-delay", pulseDelay);
        }
        const runningItem = currentThinkingRunningItem(agent);
        const label = row.querySelector(".message-thinking-label-agent");

        const nextText = runningItem
          ? buildThinkingRunningHtml(runningItem.keyword, runningItem.detail)
          : '<span class="message-thinking-running-keyword">Running...</span>';
        const nextId = runningItem ? (String(runningItem.id || "")) : "generic";
        if (label) {
          syncThinkingRunningSlot(label, {
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

      runningAgents.forEach((agent, index) => {
        const row = ensureAgentRow(agent);
        const rowAtIndex = container.children[index] || null;
        if (rowAtIndex !== row) container.insertBefore(row, rowAtIndex);
      });
      if (root.lastElementChild !== container) {
        root.appendChild(container);
      }
      root.dataset.thinkingSig = nextThinkingSig;
      const rowCount = container.querySelectorAll(".message-thinking-row[data-agent]").length;
      if (!hadContainer || rowCount !== prevRowCount) {
        document.dispatchEvent(new CustomEvent("chat-thinking-updated"));
      }
      scheduleThinkingFloatingIcons();
      maybeRestorePollScrollLock();
    };
    timeline?.addEventListener("scroll", scheduleThinkingFloatingIcons, { passive: true });
    window.addEventListener("resize", scheduleThinkingFloatingIcons, { passive: true });
    if (document.documentElement.dataset.mobile !== "1") {
      timeline?.addEventListener("click", async (event) => {
        const wrap = event.target.closest(".message-thinking-icon-wrap");
        if (!wrap) return;
        const row = wrap.closest(".message-thinking-row[data-agent]");
        if (!row) return;
        const agent = row.dataset.agent || "";
        if (!agent) return;
        try {
          const res = await fetch("/open-terminal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agent }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setStatus(data.error || "terminal open failed");
          }
        } catch (err) {
          setStatus(`terminal: ${err.message}`);
        }
      });
    }
