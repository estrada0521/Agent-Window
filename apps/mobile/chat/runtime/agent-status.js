__CHAT_INCLUDE:../../../shared/chat/hub-running-state.js__
    const renderAgentStatus = (statuses) => {
      currentAgentStatuses = { ...statuses };
      syncPaneViewerTabThinkingStatuses();
      renderThinkingIndicator();
      notifyHubRunningState();
    };
__CHAT_INCLUDE:../../../shared/chat/session-state-projections.js__
    const refreshSessionState = async (projections = null) => {
      const requestedProjections = normalizeSessionStateProjections(projections);
      if (sessionStateInFlight) {
        pendingSessionStateRefresh = true;
        pendingSessionStateProjections = mergeSessionStateProjections(pendingSessionStateProjections, requestedProjections);
        return;
      }
      sessionStateInFlight = true;
      try {
        const params = new URLSearchParams();
        params.set("ts", String(Date.now()));
        if (requestedProjections.length) {
          params.set("projections", requestedProjections.join(","));
        }
        const res = await fetchWithTimeout(`/session-state?${params.toString()}`, {}, 4000);
        if (res.ok) applySessionState(await res.json());
      } catch (_) {
      } finally {
        sessionStateInFlight = false;
        if (pendingSessionStateRefresh) {
          const nextProjections = pendingSessionStateProjections;
          pendingSessionStateRefresh = false;
          pendingSessionStateProjections = [];
          queueMicrotask(() => { void refreshSessionState(nextProjections); });
        }
      }
    };
__CHAT_INCLUDE:../../../shared/chat/session-state-events.js__
    const hoverCapabilityMedia = window.matchMedia("(hover: hover) and (pointer: fine)");
    const canUseHoverInteractions = () => hoverCapabilityMedia.matches;
    const touchBlurSelector = [
      ".quick-action",
      ".hub-page-menu-btn",
      ".composer-plus-toggle",
      ".target-chip",
      ".copy-btn",
      ".file-card",
      ".attached-files-sheet-close",
      ".send-btn",
      "#scrollToBottomBtn"
    ].join(", ");
    const syncHoverCapabilityClass = () => {
      document.documentElement.classList.toggle("has-hover", canUseHoverInteractions());
    };
    const blurTouchControlAfterTap = (event) => {
      if (canUseHoverInteractions()) return;
      const control = event.target?.closest?.(touchBlurSelector);
      if (!control) return;
      setTimeout(() => {
        if (typeof control.blur === "function") control.blur();
        const active = document.activeElement;
        if (active && active.matches?.(touchBlurSelector) && typeof active.blur === "function") {
          active.blur();
        }
      }, 0);
    };
    syncHoverCapabilityClass();
    if (hoverCapabilityMedia.addEventListener) {
      hoverCapabilityMedia.addEventListener("change", syncHoverCapabilityClass);
    } else if (hoverCapabilityMedia.addListener) {
      hoverCapabilityMedia.addListener(syncHoverCapabilityClass);
    }
    const _safariDummy = document.createElement("div");
    _safariDummy.style.cssText = "position:absolute;bottom:0;width:100%;height:env(safe-area-inset-bottom);pointer-events:none;opacity:0;z-index:-1;";
    document.body.appendChild(_safariDummy);

    const syncChatSettingsDefaults = async () => {
      try {
        const res = await fetch("/hub-settings", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        // When Chat is inside the mobile Hub, the Hub supplies the resolved
        // theme after the iframe loads.  Mobile always follows the OS
        // preference, so only resolve it here when standalone (no parent).
        if (window.parent === window) {
          document.documentElement.dataset.theme =
            window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        }
        if (typeof data?.agent_font_mode === "string" && data.agent_font_mode) {
          document.documentElement.dataset.agentFontMode = data.agent_font_mode;
        }
        if (typeof data?.chat_font_settings_css === "string") {
          const styleNode = document.getElementById("chatFontSettingsStyle");
          if (styleNode && styleNode.textContent !== data.chat_font_settings_css) {
            styleNode.textContent = data.chat_font_settings_css;
            const fileFrame = document.querySelector("#attachedFilesPanel .attached-files-preview-frame");
            if (fileFrame?.contentWindow) {
              const sz = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--message-text-size")) || 0;
              if (sz >= 8) {
                try {
                  fileFrame.contentWindow.postMessage(
                    { type: "agent-preview-text-size", size: sz },
                    window.location.origin,
                  );
                } catch (_) {}
              }
            }
          }
        }
      } catch (_) { }
    };
    syncChatSettingsDefaults();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) syncChatSettingsDefaults();
    });

    document.addEventListener("pointerdown", (e) => {
      const toggle = e.target.closest(".hub-page-menu-btn, .composer-plus-toggle, .quick-action");
      if (toggle) {
        if (toggle.classList.contains("animating")) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        flashHeaderToggle(toggle);
      }
    });
    document.addEventListener("click", blurTouchControlAfterTap, true);
    const codeCopySvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const codeCheckSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".code-copy-btn");
      if (!btn) return;
      const wrap = btn.closest(".code-block-wrap");
      if (!wrap) return;
      const code = wrap.querySelector("code") || wrap.querySelector("pre");
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.innerHTML = codeCheckSvg;
        setTimeout(() => { btn.innerHTML = codeCopySvg; }, 1500);
      });
    });
    const stripAnsiForTrace = (value) => String(value ?? "")
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\u001b\][^\u0007]*\u0007/g, "");
