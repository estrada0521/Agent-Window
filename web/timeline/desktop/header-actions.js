    const rightMenuBtn = document.getElementById("timelineMenuBtn");
    const closeHeaderMenus = () => {
      resetSubMenu({ clearOptions: true });
    };
    const renderAgentIconRgba = (src) => new Promise((resolve, reject) => {
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
        } catch (err) { reject(err); }
      };
      img.onerror = () => reject(new Error(`Agent icon failed to load: ${src}`));
      img.src = src;
    });
    const openNativeHeaderMenu = async (anchorRect = null) => {
      const rect = anchorRect || rightMenuBtn.getBoundingClientRect();

      const worktrees = await fetchGitWorktrees().catch(() => []);
      if (window.parent === window) {
        openTimelineMenu(rightMenuBtn, {
          sessionActive: !!sessionActive,
          addAgents: ALL_BASE_AGENTS,
          removeAgents: agentActionCandidates("remove"),
          repositories: gitRepositories,
          gitRepository: gitRepository(),
          worktrees,
          gitTree: gitTree(),
          gitFollow: gitFollow(),
          gitSummaryPinned,
        }, (action) => void handleTimelineMenuAction(action));
        return;
      }
      const agentIcons = {};
      const allAgentNames = [...new Set([
        ...ALL_BASE_AGENTS,
        ...agentActionCandidates("remove"),
      ])];
      await Promise.all(allAgentNames.map(async (name) => {
        const base = agentBaseName(name);
        if (!agentIcons[base]) {
          try {
            const rgba = await renderAgentIconRgba(agentIconSrc(name));
            if (rgba) agentIcons[base] = rgba;
          } catch (err) {
            setError("Agent icon unavailable", err);
          }
        }
      }));

      const payload = {
        x: Math.round(rect.left),
        y: Math.round(rect.bottom + 2),
        sessionActive: !!sessionActive,
        addAgents: ALL_BASE_AGENTS,
        removeAgents: agentActionCandidates("remove"),
        agentIcons,
        repositories: gitRepositories,
        gitRepository: gitRepository(),
        worktrees,
        gitTree: gitTree(),
        gitFollow: gitFollow(),
        gitSummaryPinned,
      };
      window.parent.postMessage({
        type: "show-timeline-header-menu",
        payload,
      }, "*");
    };
    const handleTimelineMenuAction = async (payload) => {
      const data = payload || {};
      if (["copyMessage", "copyLogEntry", "copyNativeLogEntry"].includes(data.action)) {
        try {
          const text = await messageCopyText(data.contextHash, data.action);
          await doCopyText(text);
          setStatus(data.action === "copyMessage" ? "Copied message" : data.action === "copyLogEntry" ? "Copied log entry" : "Copied native log entry");
        } catch (error) {
          setError(data.action === "copyNativeLogEntry" ? "Native log unavailable" : "Copy failed", error);
        }
        return;
      }
      if (data.action === "copyLinkURL") {
        try {
          await doCopyText(data.url);
          setStatus("Copied URL");
        } catch (error) {
          setError("Copy failed", error);
        }
        return;
      }
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
      if (data.action === "openPane") {
        await postAgentCommand({ command_id: "openpane", path: "/open-pane", target: String(data.target || "terminal") });
        return;
      }
      if (data.action === "gitFollow") {
        setGitFollow(!gitFollow());
        return;
      }
      if (data.action === "gitPin") {
        toggleGitSummaryPinned();
        return;
      }
      if (data.action === "gitRepository") {
        setGitRepository(data.repo);
        return;
      }
      if (data.action === "gitTree") {
        setGitTree(String(data.tree || ""));
        return;
      }
      const action = String(data.action || "");
      if (!action) return;
      if (action === "dockComposer" || action === "centerComposer") {
        if (isComposerOverlayOpen() && document.documentElement.dataset.autoWindowHeight !== "1") {
          setComposerDocked(action === "dockComposer");
        }
        return;
      }
      void runForwardAction(action);
    };
    window.addEventListener("message", (event) => {
      if (!(event.data && event.data.type === "native-menu-action")) return;
      void handleTimelineMenuAction(event.data.payload);
    });
    window.addEventListener("message", (event) => {
      if (!(event.data && event.data.type === "open-timeline-header-menu")) return;
      closeHeaderMenus();
      openNativeHeaderMenu(event.data.anchor).catch((err) => setError("Menu failed", err));
    });
    window.addEventListener("native-menu-action", (event) => {
      void handleTimelineMenuAction(event.detail || {});
    });
    rightMenuBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeHeaderMenus();
      openNativeHeaderMenu().catch((err) => setError("Menu failed", err));
    });
    document.getElementById("sideBarToggle").addEventListener("click", () => toggleSideBar());
    document.addEventListener("click", (event) => {

      const inRightMenu = rightMenuBtn.contains(event.target);
      const inSubMenu = document.getElementById("subMenuNativeSelect")?.contains(event.target);
      if (!inRightMenu && !inSubMenu) {
        closeHeaderMenus();
      }
    });
    async function runForwardAction(target) {
      const action = String(target || "");
      if (!action) return;
      if (action === "esc" || action === "restart" || action === "ctrlc" || action === "enter") {
        await postAgentCommand({ command_id: action, path: action === "restart" ? "/restart-agent" : "/key-macro" });
        return;
      }
      if (action === "revealLog") {
        const res = await fetch("/reveal-log", { method: "POST" });
        if (!res.ok) {
          const data = await res.json();
          setError("Reveal failed", data.error);
        }
        return;
      }
      if (action === "search") {
        beginSearch();
        return;
      }
      if (action === "exportHtml" || action === "exportJsonl") {
        if (searchOpen) endSearch();
        beginExportRange(action === "exportJsonl" ? "jsonl" : "html");
        return;
      }
      if (action === "openInBrowser") {
        await openExternalLink(`${window.location.origin}${TIMELINE_BASE_PATH}/`).catch(reportExternalLinkFailure);
        return;
      }
      if (action === "targetMessagePrevious" || action === "targetMessageNext") {
        void stepConversationByTarget(action === "targetMessageNext");
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
      if (action === "openShell") {
        try {
          const res = await fetch("/open-shell", { method: "POST" });
          if (!res.ok) {
            const data = await res.json();
            setError("Terminal unavailable", data.error);
          }
        } catch (err) {
          setError("Terminal unavailable", err);
        }
        return;
      }
      if (action === "openFinder") {
        try {
          const res = await fetch("/open-finder", { method: "POST" });
          if (!res.ok) {
            throw new Error((await res.json()).error);
          }
        } catch (err) {
          setError(err.message, err);
        }
        return;
      }
      throw new Error(`unknown menu action: ${action}`);
    }
