    const beginNewChat = async () => {
      if (reloadInFlight) return;
      reloadInFlight = true;
      if (document.body.classList.contains("right-panel-open")) closeDesktopRightPanel();
      document.documentElement.dataset.launchShell = "1";
      let response;
      try {
        response = await fetch("/new-chat", { method: "POST", cache: "no-store" });
      } catch (_) {}
      if (!response?.ok) {
        reloadInFlight = false;
        releaseLaunchShellGate();
        setStatus("reload failed", true);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      params.set("ts", String(Date.now()));
      window.location.replace(`${window.location.pathname}?${params.toString()}`);
    };
