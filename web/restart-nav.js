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
      var fadeStarted = Date.now();
      if (!view) document.documentElement.style.setProperty("--launch-title-animation", "titleFadeIn 800ms ease-out forwards");
      var open = function (restart) {
        location.replace(
          "/hub-launch-shell.html?" + (restart ? "restart=1&" : "") + (view ? "view=mobile&" : "fade_started=" + fadeStarted + "&") + "target=" + encodeURIComponent(target)
        );
      };
      fetch("/timelines", { cache: "no-store" })
        .then(function (res) { return res.json(); })
        .then(function (data) { open(data.server_instance === SERVER_INSTANCE_SEED); });
    }
