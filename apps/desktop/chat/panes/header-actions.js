    const rightMenuBtn = document.getElementById("chatMenuBtn");
    const getTauriInvoke = () => window.__TAURI__?.core?.invoke;
    const closeHeaderMenus = () => {
      resetAgentActionMenus();
    };
    const renderAgentIconRgba = (src) => new Promise((resolve) => {
      if (!src) return resolve(null);
      const SIZE = 54;
      const PAD = 7;
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
    const openNativeHeaderMenu = async (anchorRect = null) => {
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

      if (typeof invoke !== "function" && window.parent === window) {
        openChatMenu(rightMenuBtn, {
          sessionActive: !!sessionActive,
          addAgents: ALL_BASE_AGENTS.filter(Boolean),
          removeAgents: agentActionCandidates("remove"),
        }, (action) => void handleChatMenuAction(action));
        return true;
      }
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
      } else {
        window.parent.postMessage({
          type: "show-chat-header-menu",
          payload,
        }, "*");
      }
      return true;
    };
    const handleChatMenuAction = async (payload) => {
      const data = payload || {};
      if (handleDesktopFileContextMenuAction(data) || handleDesktopCommitContextMenuAction(data)) return;
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
      void runForwardAction(action);
    };
    window.addEventListener("message", (event) => {
      if (!(event.data && event.data.type === "native-menu-action")) return;
      void handleChatMenuAction(event.data.payload);
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
      closeHeaderMenus();
      openNativeHeaderMenu(anchorRect).catch((err) => setStatus(`header menu failed: ${err}`));
    });
    window.addEventListener("native-menu-action", (event) => {
      void handleChatMenuAction(event.detail || {});
    });
    rightMenuBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeHeaderMenus();
      openNativeHeaderMenu().catch((err) => setStatus(`header menu failed: ${err}`));
    });
    document.getElementById("chatReloadBtn").addEventListener("click", () => void reloadChat());
    document.getElementById("chatPanelToggle").addEventListener("click", () => toggleDesktopRightPanel());
    window.addEventListener("resize", () => {
      if (dpPanelOpen) {
        dpApplyPanelWidth();
      }
      syncPanelState();
    });
    document.addEventListener("click", (event) => {

      const inRightMenu = rightMenuBtn.contains(event.target);
      const agentActionNativeMenu = document.getElementById("agentActionNativeMenuSelect");
      const inAgentActionMenu = agentActionNativeMenu?.contains(event.target);
      if (!inRightMenu && !inAgentActionMenu) {
        closeHeaderMenus();
      }
    });
    async function runForwardAction(target) {
      const action = String(target || "");
      if (!action) return;
      if (action === "esc" || action === "restart" || action === "ctrlc" || action === "enter") {
        await postShortcutCommand({ command_id: action, arg: "" });
        return;
      }
      if (action === "reloadChat") {
        await reloadChat();
        return;
      }
      if (action === "revealLog") {
        const res = await fetch("/reveal-log", { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setStatus(data.error || "Reveal failed");
        }
        return;
      }
      if (action === "openInBrowser") {
        await openExternalLink(`${window.location.protocol}//${window.location.hostname}:__CHAT_PORT__/`).catch(reportExternalLinkFailure);
        return;
      }
      if (action === "messagePrevious" || action === "messageNext") {
        stepConversationByMessage(action === "messageNext");
        return;
      }
      if (action === "messageJumpTop") {
        jumpConversationToTop();
        return;
      }
      if (action === "messageJumpBottom") {
        jumpConversationToBottom();
        return;
      }
      if (action === "openTerminal") {
        try {
          const res = await fetch("/open-terminal", { method: "POST" });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setStatus(data.error || "terminal open failed");
          }
        } catch (err) {
          setStatus(`terminal: ${err.message}`);
        }
        return;
      }
      if (action === "openShell") {
        try {
          const res = await fetch("/open-shell", { method: "POST" });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setStatus(data.error || "terminal open failed");
          }
        } catch (err) {
          setStatus(`terminal: ${err.message}`);
        }
        return;
      }
      if (action === "openFinder") {
        try {
          const res = await fetch("/open-finder", { method: "POST" });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setStatus(data.error || "Finder open failed");
          }
        } catch (err) {
          setStatus(`Finder: ${err.message}`);
        }
        return;
      }
      throw new Error(`unknown menu action: ${action}`);
    }
