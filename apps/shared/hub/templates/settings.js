    const HUB_EMBED = document.documentElement.dataset.hubEmbed === "1";
    const VIEW_VARIANT = document.documentElement.dataset.viewVariant || "";
    const isMobileView = VIEW_VARIANT === "mobile";

    const boldMobileToggle = document.querySelector('#settingsFormMobile input[name="bold_mode_mobile"]');
    const initialThemeValue = document.documentElement.dataset.theme || "dark";
    let _themeReloadPending = false;
    const systemPrefersDark = () => {
      try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (_) { return true; }
    };
    const hubThemeForDesktop = (themeDesktop) => {
      if (themeDesktop === "system") return systemPrefersDark() ? "dark" : "light";
      if (themeDesktop === "split") return "dark";
      return themeDesktop === "light" ? "light" : "dark";
    };

    const themeMobileSelect = document.getElementById("themeMobileSelect");
    if (themeMobileSelect) {
      const initialMobileTheme = themeMobileSelect.dataset.initialValue || initialThemeValue;
      const embeddedInHub = window.self !== window.top;
      const resolveMobileTheme = (value) => value === "system"
        ? (systemPrefersDark() ? "dark" : "light")
        : (value === "light" ? "light" : "dark");
      const applyMobileThemeSelection = (value, { save = true } = {}) => {
        try {
          if (embeddedInHub) {
            // The mobile Hub owns the effective theme.  This frame only owns
            // the saved preference, so it can never independently follow an
            // OS preference change while Light or Dark is selected.
            window.top.postMessage({ type: "hub-mobile-theme-mode-changed", themeMobile: value }, "*");
          } else {
            document.documentElement.dataset.theme = resolveMobileTheme(value);
          }
        } catch (_) {}
        if (save && typeof _doAutoSave === "function") {
          clearTimeout(_autoSaveTimer);
          _autoSaveTimer = setTimeout(_doAutoSave, 150);
        }
      };
      if (["system", "light", "dark"].includes(initialMobileTheme)) {
        themeMobileSelect.value = initialMobileTheme;
        if (!embeddedInHub && initialMobileTheme === "system") applyMobileThemeSelection("system", { save: false });
      }
      themeMobileSelect.addEventListener("change", () => {
        const selectedMode = themeMobileSelect.value;
        _themeReloadPending = resolveMobileTheme(selectedMode) !== initialThemeValue;
        applyMobileThemeSelection(selectedMode);
      });
      if (!embeddedInHub) {
        try {
          window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
            if (themeMobileSelect.value === "system") applyMobileThemeSelection("system", { save: false });
          });
        } catch (_) {}
      }
      window.addEventListener("message", (event) => {
        const data = event.data;
        if (data?.type !== "hub-theme-changed") return;
        if (data.theme === "light" || data.theme === "dark") {
          document.documentElement.dataset.theme = data.theme;
        }
      });
      if (embeddedInHub) {
        const reportObservedSystemTheme = () => {
          if (themeMobileSelect.value !== "system") return;
          try {
            window.top.postMessage({
              type: "hub-mobile-system-theme-observed",
              theme: systemPrefersDark() ? "dark" : "light",
            }, "*");
          } catch (_) {}
        };
        try {
          const query = window.matchMedia("(prefers-color-scheme: dark)");
          if (query.addEventListener) query.addEventListener("change", reportObservedSystemTheme);
          else if (query.addListener) query.addListener(reportObservedSystemTheme);
        } catch (_) {}
        window.addEventListener("pageshow", reportObservedSystemTheme);
        window.addEventListener("focus", reportObservedSystemTheme);
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) reportObservedSystemTheme();
        });
      }
    }

    const themeDesktopSelect = document.getElementById("theme_desktop");
    // Both desktop and mobile forms are present in this template.  Do not let
    // the hidden desktop control observe OS changes inside a mobile sheet.
    if (themeDesktopSelect && !isMobileView) {
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

    const applyBoldMode = () => {
      const html = document.documentElement;
      const mobileBold = boldMobileToggle?.checked;
      const active = isMobileView && mobileBold;
      if (active) {
        html.dataset.boldMode = '1';
      } else {
        delete html.dataset.boldMode;
      }
    };
    boldMobileToggle?.addEventListener('change', applyBoldMode);
    applyBoldMode();

    const _makeNumberStepper = (input, minusBtnId, plusBtnId, valueDisplayId, onApply, options = {}) => {
      if (!input) return;
      const min = Number.isFinite(options.min) ? options.min : 11;
      const max = Number.isFinite(options.max) ? options.max : 18;
      const fallback = Number.isFinite(options.fallback) ? options.fallback : min;
      input.value = String(Math.max(min, Math.min(max, parseInt(input.value, 10) || fallback)));
      const apply = () => {
        const sz = Math.max(min, Math.min(max, parseInt(input.value, 10) || fallback));
        input.value = String(sz);
        const disp = valueDisplayId ? document.getElementById(valueDisplayId) : null;
        if (disp) disp.textContent = sz;
        if (onApply) onApply(sz);
      };
      apply();
      input.addEventListener('input', apply);
      input.addEventListener('change', apply);
      const minus = minusBtnId ? document.getElementById(minusBtnId) : null;
      const plus = plusBtnId ? document.getElementById(plusBtnId) : null;
      const triggerSave = () => { if (typeof _doAutoSave === 'function') { clearTimeout(_autoSaveTimer); _autoSaveTimer = setTimeout(_doAutoSave, 350); } };
      if (minus) minus.addEventListener('click', (e) => { e.preventDefault(); const v = parseInt(input.value, 10) || fallback; const n = Math.max(min, v - 1); if (v !== n) { input.value = n; apply(); triggerSave(); } });
      if (plus) plus.addEventListener('click', (e) => { e.preventDefault(); const v = parseInt(input.value, 10) || fallback; const n = Math.min(max, v + 1); if (v !== n) { input.value = n; apply(); triggerSave(); } });
    };
    const _makeTextSizeStepper = (input, minusBtnId, plusBtnId, valueDisplayId, onApply) => {
      _makeNumberStepper(input, minusBtnId, plusBtnId, valueDisplayId, onApply, { min: 8, max: 18, fallback: 13 });
    };
    let activeTextSizeInput = null;
    if (isMobileView) {
      activeTextSizeInput = document.getElementById('textSizeMobileInput');
      _makeTextSizeStepper(
        activeTextSizeInput,
        'textSizeMobileMinus', 'textSizeMobilePlus', 'textSizeMobileValue',
        (sz) => document.documentElement.style.setProperty('--settings-text-size', sz + 'px')
      );
      _makeTextSizeStepper(
        document.getElementById('textSizeDesktopInput'),
        'textSizeDesktopMinus', 'textSizeDesktopPlus', 'textSizeDesktopValue',
        null
      );
    } else {
      const desktopInput = document.querySelector('#settingsFormDesktop [name="message_text_size_desktop"]');
      activeTextSizeInput = desktopInput;
      _makeTextSizeStepper(desktopInput, null, null, null,
        (sz) => document.documentElement.style.setProperty('--settings-text-size', sz + 'px')
      );
      const mobileInput = document.querySelector('#settingsFormDesktop [name="message_text_size_mobile"]');
      _makeTextSizeStepper(mobileInput, null, null, null, null);

      const _parentRoot = () => {
        try { return window.self !== window.top ? window.parent.document.documentElement : null; } catch (_) { return null; }
      };
    }

    const activeForm = isMobileView
      ? document.getElementById('settingsFormMobile')
      : document.getElementById('settingsFormDesktop');
    const settingsForm = activeForm;
    if (HUB_EMBED && settingsForm) {
      settingsForm.action = "/settings?embed=1";
    }
    const closeSettingsPage = () => {
      if (HUB_EMBED && window.self !== window.top) {
        window.parent.postMessage({ type: "hub-close-sidebar-page" }, "*");
        return;
      }
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = "/";
    };
    let _autoSaveTimer = null;
    const _doAutoSave = async () => {
      if (!settingsForm || settingsForm.dataset.saving === "1") return;
      settingsForm.dataset.saving = "1";
      const payload = new URLSearchParams();
      const formData = new FormData(settingsForm);
      for (const [key, value] of formData.entries()) {
        payload.append(key, String(value));
      }
      if (activeTextSizeInput) {
        payload.set("message_text_size", String(activeTextSizeInput.value || ""));
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
    const hubRestartForm = document.querySelector(".hub-restart-form");
    if (hubRestartForm) {
      hubRestartForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = e.currentTarget.querySelector("button");
        if (btn.classList.contains("restarting")) return;
        btn.classList.add("restarting");
        btn.disabled = true;
        btn.textContent = "Restarting…";
        const resetBtn = (errMsg) => {
          btn.classList.remove("restarting");
          btn.disabled = false;
          btn.textContent = "Restart Hub";
          if (errMsg) window.alert(errMsg);
        };
        let restartRes;
        try { restartRes = await fetch("/restart-hub", { method: "POST" }); } catch (err) {
          resetBtn(err?.message || "restart failed");
          return;
        }
        if (!restartRes.ok) {
          let errMsg = "restart failed";
          try { const d = await restartRes.json(); errMsg = d?.error || errMsg; } catch (_) {}
          resetBtn(errMsg);
          return;
        }
        const started = Date.now();
        const poll = async () => {
          try {
            const res = await fetch(`/sessions?ts=${Date.now()}`, { cache: "no-store" });
            if (res.ok) { window.location.replace(window.location.pathname); return; }
          } catch (_) {}
          if (Date.now() - started < 20000) { setTimeout(poll, 500); } else { resetBtn("hub did not restart in time"); }
        };
        setTimeout(poll, 700);
      });
    }
  __HUB_HEADER_JS__
