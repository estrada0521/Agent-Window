    const headerRoot = document.querySelector(".hub-page-header");
    const shellRoot = document.querySelector(".shell");
    const hasOpenHeaderMenu = () => !!rightMenuPanel?.classList.contains("open");
    const updateHeaderMenuViewportMetrics = () => {
      if (!headerRoot) return;
      const headerRect = headerRoot.getBoundingClientRect();
      const shellRect = shellRoot?.getBoundingClientRect?.() || headerRect;
      const top = Math.max(0, Math.round(headerRect.bottom));
      const left = Math.max(0, Math.round(shellRect.left));
      const width = Math.max(0, Math.round(shellRect.width));
      const right = Math.max(0, Math.round((window.innerWidth || 0) - (shellRect.right || (left + width))));
      document.documentElement.style.setProperty("--header-menu-top", `${top}px`);
      document.documentElement.style.setProperty("--header-menu-left", `${left}px`);
      document.documentElement.style.setProperty("--header-menu-width", `${width}px`);
      document.documentElement.style.setProperty("--chat-surface-left", `${left}px`);
      document.documentElement.style.setProperty("--chat-surface-width", `${width}px`);
      document.documentElement.style.setProperty("--chat-surface-right", `${right}px`);
    };
    const syncHeaderMenuFocus = () => {
      if (hasOpenHeaderMenu()) updateHeaderMenuViewportMetrics();
    };
    const needsHeaderViewportMetrics = () => hasOpenHeaderMenu();
    const closeHeaderMenus = () => {
      resetAgentActionMenus();
      rightMenuPanel?.classList.remove("open");
      if (rightMenuPanel) rightMenuPanel.hidden = true;
      rightMenuBtn?.classList.remove("open");
      syncHeaderMenuFocus();
    };
    const renderAgentIconRgba = (src) => new Promise((resolve) => {
      if (!src) return resolve(null);
      const SIZE = 22;
      const PAD = 3;
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = SIZE;
          canvas.height = SIZE;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, PAD, PAD, SIZE - PAD * 2, SIZE - PAD * 2);
          const imgData = ctx.getImageData(0, 0, SIZE, SIZE);
          const px = imgData.data;
          const iconVal = window.matchMedia("(prefers-color-scheme: dark)").matches ? 255 : 0;
          for (let i = 0; i < px.length; i += 4) {
            px[i] = iconVal; px[i + 1] = iconVal; px[i + 2] = iconVal;
          }
          resolve(Array.from(px));
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
    const openTauriHeaderMenu = async (anchorRect = null) => {
      const invoke = getTauriInvoke();
      const fallbackRect = rightMenuBtn?.getBoundingClientRect?.() || null;
      const hasExplicitAnchor = !!(anchorRect && typeof anchorRect === "object");
      const rectSource = hasExplicitAnchor ? anchorRect : fallbackRect;
      if (!rectSource) return false;
      const rect = {
        left: Number(rectSource.left || 0),
        top: Number(rectSource.top || 0),
        right: Number(rectSource.right || 0),
        bottom: Number(rectSource.bottom || 0),
        width: Number(rectSource.width || 24),
        height: Number(rectSource.height || 24),
      };

      const agentIcons = {};
      const allAgentNames = [...new Set([
        ...ALL_BASE_AGENTS.filter(Boolean),
        ...agentActionCandidates("remove"),
      ])];
      await Promise.all(allAgentNames.map(async (name) => {
        const base = agentBaseName(name);
        if (!agentIcons[base]) {
          try {
            const rgba = await renderAgentIconRgba(agentIconSrc(name));
            if (rgba) agentIcons[base] = rgba;
          } catch (_) {}
        }
      }));

      const payload = {
        x: Math.round(rect.left || 0),
        y: Math.round((rect.bottom || ((rect.top || 0) + (rect.height || 28))) + 2),
        sessionActive: !!sessionActive,
        addAgents: ALL_BASE_AGENTS.filter(Boolean),
        removeAgents: agentActionCandidates("remove"),
        agentIcons,
      };
      if (typeof invoke === "function") {
        await invoke("show_chat_header_menu", { payload });
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: "show-chat-header-menu",
          payload,
        }, "*");
      } else {
        return false;
      }
      return true;
    };
    const handleTauriNativeMenuAction = async (payload) => {
      const data = payload || {};
      if (data.action === "agent") {
        const mode = String(data.mode || "");
        const agent = String(data.agent || "");
        if ((mode === "add" || mode === "remove") && agent) {
          closeHeaderMenus();
          await performAgentAction(mode, agent);
        }
        return;
      }
      const action = String(data.action || "");
      if (!action) return;
      void runForwardAction(action, { sourceNode: null, keepComposerOpen: false, keepHeaderOpen: false });
    };
    window.addEventListener("message", (event) => {
      if (!(event.data && event.data.type === "native-menu-action")) return;
      void handleTauriNativeMenuAction(event.data.payload);
    });
    window.addEventListener("message", (event) => {
      if (!(event.data && event.data.type === "open-chat-header-menu")) return;
      const anchorData = event.data.anchor || null;
      const anchorRect = anchorData && typeof anchorData === "object"
        ? {
            left: Number(anchorData.left || 0),
            top: Number(anchorData.top || 0),
            right: Number(anchorData.right || 0),
            bottom: Number(anchorData.bottom || 0),
            width: Number(anchorData.width || 24),
            height: Number(anchorData.height || 24),
          }
        : null;
      if (hasTauriNativeHeaderMenu()) {
        closeHeaderMenus();
        openTauriHeaderMenu(anchorRect).catch(() => {});
        return;
      }
      rightMenuBtn?.click();
    });
    window.addEventListener("native-menu-action", (event) => {
      void handleTauriNativeMenuAction(event.detail || {});
    });
    rightMenuBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (hasTauriNativeHeaderMenu()) {
        closeHeaderMenus();
        openTauriHeaderMenu().catch(() => {});
        return;
      }
      closeHeaderMenus();
    });
    const closeQuickMore = () => {
      if (quickMore) quickMore.open = false;
      closePlusMenu();
      closeHeaderMenus();
    };
    window.addEventListener("resize", () => {
      if (dpPanelOpen) {
        dpApplyPanelWidth();
      }
      if (needsHeaderViewportMetrics()) updateHeaderMenuViewportMetrics();
    });
    window.addEventListener("scroll", () => {
      if (needsHeaderViewportMetrics()) updateHeaderMenuViewportMetrics();
    }, { passive: true });
    document.addEventListener("click", (event) => {
      if (quickMore && quickMore.open && !quickMore.contains(event.target)) {
        quickMore.open = false;
      }
      if (composerPlusMenu && composerPlusMenu.open && !composerPlusMenu.contains(event.target) && !event.target.closest(".target-chip")) {
        closePlusMenu();
      }
      const inRightMenu = rightMenuBtn?.contains(event.target) || rightMenuPanel?.contains(event.target);
      const inNativeBridgeMenu = nativeHeaderMenuBridge?.contains(event.target);
      const agentActionNativeMenu = document.getElementById("agentActionNativeMenuSelect");
      const inAgentActionMenu = agentActionNativeMenu?.contains(event.target);
      if (!inRightMenu && !inNativeBridgeMenu && !inAgentActionMenu) {
        closeHeaderMenus();
      }
    });
    async function runForwardAction(target, { sourceNode = null, keepComposerOpen = false, keepHeaderOpen = false } = {}) {
      const action = String(target || "");
      if (!action) return;
      if (keepComposerOpen) flashComposerAction(action);
      if (action === "esc" || action === "restart" || action === "resume" || action === "ctrlc" || action === "enter") {
        if (!keepComposerOpen) closeQuickMore();
        await postShortcutCommand({ command_id: action, arg: "" });
        if (keepComposerOpen && composerPlusMenu) {
          requestAnimationFrame(() => { composerPlusMenu.open = true; });
        }
        return;
      }
      if (action === "reloadChat") {
        await beginChatReload(sourceNode);
        return;
      }
      if (action === "openTerminal") {
        closeQuickMore();
        fetch("/open-terminal", { method: "POST" }).catch(() => {});
        return;
      }
      if (action === "openFinder") {
        closeQuickMore();
        try {
          const res = await fetch("/open-finder", { method: "POST" });
          if (res.ok) {
            setStatus("opened Finder");
            setTimeout(() => setStatus(""), 1800);
          } else {
            const data = await res.json().catch(() => ({}));
            setStatus(data.error || "Finder open failed", true);
            setTimeout(() => setStatus(""), 2600);
          }
        } catch (err) {
          setStatus(`Finder open error: ${err.message}`, true);
          setTimeout(() => setStatus(""), 2600);
        }
        return;
      }
      if (action === "addAgent") {
        if (!sessionActive) {
          setStatus("archived session is read-only", true);
          setTimeout(() => setStatus(""), 2000);
          return;
        }
        if (!keepHeaderOpen) closeQuickMore();
        showAddAgentModal();
        return;
      }
      if (action === "removeAgent") {
        if (!sessionActive) {
          setStatus("archived session is read-only", true);
          setTimeout(() => setStatus(""), 2000);
          return;
        }
        if (!keepHeaderOpen) closeQuickMore();
        showRemoveAgentModal();
        return;
      }
      document.getElementById(action)?.click();
      if (keepComposerOpen && composerPlusMenu) {
        requestAnimationFrame(() => { composerPlusMenu.open = true; });
      }
      if (keepHeaderOpen && rightMenuPanel && rightMenuBtn) {
        requestAnimationFrame(() => {
          rightMenuPanel.hidden = false;
          rightMenuPanel.classList.add("open");
          rightMenuBtn.classList.add("open");
        });
      }
    }
    document.querySelectorAll("[data-forward-action]").forEach((node) => {
      node.addEventListener("mousedown", (e) => e.preventDefault());
      node.addEventListener("click", async () => {
        const target = node.dataset.forwardAction || "";
        const keepComposerOpen = !!(composerPlusMenu && composerPlusMenu.contains(node));
        const keepHeaderOpen = !!(rightMenuPanel && rightMenuPanel.contains(node));
        await runForwardAction(target, { sourceNode: node, keepComposerOpen, keepHeaderOpen });
      });
    });
    document.querySelectorAll(".quick-action:not(.quick-more-toggle):not(.plus-submenu-toggle):not([data-forward-action]):not(#attachBtn)").forEach((node) => {
      node.addEventListener("click", async () => {
        closeQuickMore();
        const sc = node.dataset.shortcut || "";
        if (sc) {
          await postShortcutCommand({ command_id: sc, arg: "" });
        }
      });
    });
