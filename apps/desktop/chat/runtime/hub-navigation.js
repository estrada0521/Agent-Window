    const hubBtn = document.getElementById("pageTitleLink");
    const isDesktopHubShell = document.documentElement.dataset.hubShell === "1";
    const isTauriDesktopApp = document.documentElement.dataset.tauriApp === "1";
    const isTauriHubIframeChat = isTauriDesktopApp && document.documentElement.dataset.hubIframeChat === "1";
    const hubHeaderRoot = document.querySelector(".shell > .page-header");
    const hubHeaderTop = hubHeaderRoot?.querySelector(".page-header-top") || null;
    const hubHeaderActions = hubHeaderTop?.querySelector(".page-header-actions") || null;
    const shouldFloatHeaderActions = isDesktopHubShell || (isTauriDesktopApp && !isTauriHubIframeChat);
    if (shouldFloatHeaderActions && hubHeaderActions) {
      if (hubHeaderActions) {
        hubHeaderActions.classList.add("page-header-actions-floating");
        if (hubHeaderActions.parentElement !== document.body) {
          document.body.appendChild(hubHeaderActions);
        }
      }
    }
    if (isDesktopHubShell && hubHeaderRoot && hubHeaderTop) {
      hubHeaderTop.remove();
    }
    if (isTauriHubIframeChat && hubHeaderRoot) {
      hubHeaderRoot.remove();
    }
    hubBtn?.remove();
    const openHubPath = (path = "/") => {
      const hubHost = window.location.hostname || "127.0.0.1";
      const normalizedPath = String(path || "/").startsWith("/") ? String(path || "/") : `/${String(path || "/")}`;
      const hubUrl = `${window.location.protocol}//${hubHost}:__HUB_PORT__${normalizedPath}`;
      if (window.self !== window.top) {
        if (normalizedPath === "/") {
          window.parent.postMessage({ type: "toggle-hub-sidebar" }, "*");
          return;
        }
        try {
          window.parent.location.href = hubUrl;
          return;
        } catch (_err) {
          window.parent.postMessage({ type: "open-hub-path", url: hubUrl }, "*");
          return;
        }
      }
      window.location.href = hubUrl;
    };
    window.addEventListener("message", (event) => {
      if (!(event.data && event.data.type === "hub-sidebar-state")) return;
      const isOpen = !!event.data.open;
      if (isOpen) document.documentElement.dataset.hubSidebarOpen = "1";
      else delete document.documentElement.dataset.hubSidebarOpen;
    });
    if (!isDesktopHubShell) {
      hubBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        openHubPath("/");
      });
    }