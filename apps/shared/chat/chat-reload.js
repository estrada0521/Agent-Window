    const beginChatReload = async (button) => {
      if (reloadInFlight) return;
      reloadInFlight = true;
      document.documentElement.dataset.launchShell = "1";
      if (button) {
        button.disabled = true;
        button.classList.add("restarting");
        button.textContent = "Restarting…";
      }
      let response;
      try {
        response = await fetch("/new-chat", { method: "POST", cache: "no-store" });
      } catch (_) {}
      if (!response?.ok) {
        reloadInFlight = false;
        releaseLaunchShellGate();
        if (button) {
          button.disabled = false;
          button.classList.remove("restarting");
          button.textContent = "Reload";
        }
        setStatus("reload failed", true);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      params.set("follow", followMode ? "1" : "0");
      params.set("ts", String(Date.now()));
      window.location.replace(`${window.location.pathname}?${params.toString()}`);
    };
