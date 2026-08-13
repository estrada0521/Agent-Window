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
    const activeTextSizeInput = document.querySelector('#settingsFormDesktop [name="message_text_size_desktop"]');
    _makeTextSizeStepper(activeTextSizeInput, null, null, null, null);

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
