    const HUB_EMBED = document.documentElement.dataset.hubEmbed === "1";

    const initialThemeValue = document.documentElement.dataset.theme || "dark";
    let _themeReloadPending = false;
    const systemPrefersDark = () => {
      try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (_) { return true; }
    };
    const hubThemeForDesktop = (themeDesktop) => {
      if (themeDesktop === "system") return systemPrefersDark() ? "dark" : "light";
      return themeDesktop === "light" ? "light" : "dark";
    };

    const themeDesktopSelect = document.getElementById("theme_desktop");
    if (themeDesktopSelect) {
      const applyThemeDesktopSelection = (nextTheme) => {
        document.documentElement.dataset.theme = hubThemeForDesktop(nextTheme);
        try {
          if (window.self !== window.top) {
            window.top.postMessage({ type: "hub-theme-changed", themeDesktop: nextTheme }, "*");
          }
        } catch (_) {}
      };
      // Standalone (non-embedded) settings page: self-correct immediately on load.
      if (window.self === window.top && themeDesktopSelect.value === "system") {
        applyThemeDesktopSelection("system");
      }
      themeDesktopSelect.addEventListener("change", () => {
        const nextTheme = themeDesktopSelect.value;
        applyThemeDesktopSelection(nextTheme);
        _themeReloadPending = nextTheme !== initialThemeValue;
        if (typeof _doAutoSave === "function") {
          clearTimeout(_autoSaveTimer);
          _autoSaveTimer = setTimeout(_doAutoSave, 150);
        }
      });
      try {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
          if (themeDesktopSelect.value === "system") applyThemeDesktopSelection("system");
        });
      } catch (_) {}
    }

    const settingsForm = document.getElementById('settingsFormDesktop');
    if (HUB_EMBED && settingsForm) {
      settingsForm.action = "/settings?embed=1";
    }
    let _autoSaveTimer = null;
    const _doAutoSave = async () => {
      if (!settingsForm || settingsForm.dataset.saving === "1") return;
      settingsForm.dataset.saving = "1";
      const payload = new URLSearchParams();
      const formData = new FormData(settingsForm);
      for (const [key, value] of formData.entries()) {
        payload.append(key, String(value));
      }
      try {
        await fetch(settingsForm.action || "/settings", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: payload.toString(),
          cache: "no-store",
        });
        _themeReloadPending = false;
      } catch (_) {}
      settingsForm.dataset.saving = "0";
    };
    if (settingsForm) {
      settingsForm.addEventListener("change", () => {
        clearTimeout(_autoSaveTimer);
        _autoSaveTimer = setTimeout(_doAutoSave, 350);
      });
    }
  __HUB_HEADER_JS__
