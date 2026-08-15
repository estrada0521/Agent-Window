    const syncChatSettingsDefaults = async () => {
      try {
        const res = await fetch("/hub-settings", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const _themeDesktop = String(data?.theme_desktop ?? data?.theme ?? "").trim().toLowerCase();
        const _chatTheme = _themeDesktop === "system"
          ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
          : (_themeDesktop === "light" ? "light" : "dark");
        document.documentElement.dataset.theme = _chatTheme;
        if (typeof data?.agent_font_mode === "string" && data.agent_font_mode) {
          document.documentElement.dataset.agentFontMode = data.agent_font_mode;
        }
        if (typeof data?.chat_font_settings_css === "string") {
          const styleNode = document.getElementById("chatFontSettingsStyle");
          if (styleNode && styleNode.textContent !== data.chat_font_settings_css) {
            styleNode.textContent = data.chat_font_settings_css;
          }
        }
      } catch (_) {}
    };
    syncChatSettingsDefaults();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        syncChatSettingsDefaults();
        void refreshSessionState();
      }
    });
