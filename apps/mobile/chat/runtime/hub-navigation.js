    const hubBtn = document.getElementById("pageTitleLink");
    const hubRootUrl = () => {
      if (CHAT_BASE_PATH || String(window.location.pathname || "").startsWith("/session/")) {
        return `${window.location.origin}/`;
      }
      const portValue = Number(CHAT_BOOTSTRAP.hubPort || 0);
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
      const normalizedPath = String(path || "/").startsWith("/") ? String(path || "/") : `/${String(path || "/")}`;
      return `${hubRootUrl().replace(/\/$/, "")}${normalizedPath}`;
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
      const normalizedPath = String(path || "/").startsWith("/") ? String(path || "/") : `/${String(path || "/")}`;
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
