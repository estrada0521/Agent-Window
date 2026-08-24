    function beginHubRestart(button) {
      if (window.__agentWindowHubRestarting) return;
      window.__agentWindowHubRestarting = true;
      if (button) {
        button.disabled = true;
        button.classList.add("restarting");
      }
      var current = new URL(window.location.href);
      var view = current.searchParams.get("view") === "mobile" ? "mobile" : "";
      var target = view ? "/?view=mobile" : "/";
      var launchShellTarget = "/hub-launch-shell.html?restart=1" + (view ? "&view=mobile" : "") + "&target=" + encodeURIComponent(target);
      try {
        location.replace(launchShellTarget);
      } catch (_) {
        location.href = launchShellTarget;
      }
    }
