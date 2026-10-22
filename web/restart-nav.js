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
      if (view) {
        document.documentElement.dataset.hubLoading = "1";
        var shell = document.getElementById("launchShell");
        shell.hidden = false;
        shell.dataset.reloadStage = "1";
        shell.classList.add("visible");
      }
      var fadeStarted = Date.now();
      if (!view) document.documentElement.style.setProperty("--launch-title-animation", "titleFadeIn 800ms ease-out forwards");
      var open = function (restart) {
        location.replace(
          "/hub-launch-shell.html?" + (restart ? "restart=1&" : "") + (view ? "view=mobile&" : "fade_started=" + fadeStarted + "&") + "target=" + encodeURIComponent(target)
        );
      };
      fetch("/timelines", { cache: "no-store" })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var restart = data.server_instance === SERVER_INSTANCE_SEED;
          if (!view) {
            open(restart);
            return;
          }
          return (restart ? fetch("/restart-hub", { method: "POST" }).then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
          }) : Promise.resolve()).then(function () {
            return fetch("/?view=mobile&launch_shell=1", { cache: "no-store" });
          }).then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.text();
          }).then(function (html) {
            disposeHub();
            history.replaceState(history.state, "", "/?view=mobile&launch_shell=1");
            document.open();
            document.write(html);
            document.close();
          });
        }).catch(function (error) {
          if (!view) throw error;
          window.__agentWindowHubRestarting = false;
          hideLaunchShell();
          setError("Reload failed", error);
        });
    }
