    const hubBtn = document.getElementById("pageTitleLink");
    const hubRootUrl = () => {
      if (CHAT_BASE_PATH || String(window.location.pathname || "").startsWith("/session/")) {
        return `${window.location.origin}/`;
      }
      const portValue = Number(__HUB_PORT__) || 0;
      const protocol = window.location.protocol || "http:";
      const host = window.location.hostname || "127.0.0.1";
      const defaultPort =
        (protocol === "https:" && portValue === 443) ||
        (protocol === "http:" && portValue === 80);
      if (portValue > 0 && !defaultPort) {
        return `${protocol}//${host}:${portValue}/`;
      }
      return `${protocol}//${host}/`;
    };
    const hubUrlForPath = (path = "/") => {
      const normalizedPath = normalizeHubPath(path);
      const raw = `${hubRootUrl().replace(/\/$/, "")}${normalizedPath}`;
      try {
        // This file only ever runs as the mobile chat, so a bare hub URL
        // would otherwise re-render as desktop for non-touch browsers
        // (e.g. leaving the chat as a top-level tab, not inside the hub's
        // iframe, where nothing else re-adds view=mobile for us).
        const url = new URL(raw);
        url.searchParams.set("view", "mobile");
        return url.toString();
      } catch (_) {
        return raw;
      }
    };
    const requestHubTop = () => {
      const hubUrl = hubUrlForPath("/");
      if (window.self !== window.top) {
        try {
          window.parent.postMessage({ type: "open-hub-path", url: hubUrl, reveal: true }, "*");
        } catch (_) {
          requestHubCloseChat();
        }
        return;
      }
      window.location.href = hubUrl;
    };
    const openHubPath = (path = "/") => {
      const normalizedPath = normalizeHubPath(path);
      const hubUrl = hubUrlForPath(normalizedPath);
      if (window.self !== window.top) {
        if (normalizedPath === "/") {
          requestHubTop();
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
    hubBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      openHubPath("/");
    });
