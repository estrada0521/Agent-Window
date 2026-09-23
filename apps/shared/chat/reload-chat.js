    const reloadChat = async () => {
      if (reloadInFlight) return;
      reloadInFlight = true;
      if (document.body.classList.contains("right-panel-open")) closeDesktopRightPanel();
      document.documentElement.dataset.launchShell = "1";
      let error = "";
      const current = await (await fetch("/session-state", { cache: "no-store" })).json();
      if (current.server_instance === SERVER_INSTANCE_SEED) {
        try {
          const response = await fetch("/reload-chat", { method: "POST", cache: "no-store" });
          if (!response.ok) {
            error = response.headers.get("Content-Type")?.includes("json")
              ? (await response.json()).error
              : await response.text();
          }
        } catch (err) {
          error = err.message;
        }
      }
      if (error) {
        reloadInFlight = false;
        releaseLaunchShellGate();
        setStatus(`reload failed: ${error}`);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      params.set("ts", String(Date.now()));
      window.location.replace(`${window.location.pathname}?${params.toString()}`);
    };
