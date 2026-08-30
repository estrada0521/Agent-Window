    const syncChatSettingsDefaults = async () => {
      try {
        const res = await fetch(
          document.documentElement.dataset.mobile === "1" ? "/hub-settings?view=mobile" : "/hub-settings",
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = await res.json();
        const _isMobile = document.documentElement.dataset.mobile === "1";
        const _themeSetting = String(
          (_isMobile ? data?.theme_mobile : data?.theme_desktop) ?? "",
        ).trim().toLowerCase();
        const _chatTheme = _themeSetting === "system" || (_isMobile && !_themeSetting)
          ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
          : (_themeSetting === "light" ? "light" : "dark");
        document.documentElement.dataset.theme = _chatTheme;
        if (_isMobile) document.documentElement.dataset.themeMobileSetting = _themeSetting || "system";
        if (typeof data?.chat_font_settings_css === "string") {
          const styleNode = document.getElementById("chatFontSettingsStyle");
          if (styleNode && styleNode.textContent !== data.chat_font_settings_css) {
            styleNode.textContent = data.chat_font_settings_css;
            if (document.documentElement.dataset.mobile === "1") {
              const fileFrame = document.querySelector("#repoPanel .repo-preview-frame");
              if (fileFrame?.contentWindow) {
                const sz = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-size")) || 0;
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
