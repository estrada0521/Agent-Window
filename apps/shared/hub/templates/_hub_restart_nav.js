    function beginHubRestart(button) {
      if (window.__agentWindowHubRestarting) return;
      window.__agentWindowHubRestarting = true;
      if (button) {
        button.disabled = true;
        button.classList.add("restarting");
      }
      var launchShellTarget = "/hub-launch-shell.html?restart=1&target=" + encodeURIComponent("/");
      try {
        location.replace(launchShellTarget);
      } catch (_) {
        location.href = launchShellTarget;
      }
    }
