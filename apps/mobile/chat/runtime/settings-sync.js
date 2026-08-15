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
