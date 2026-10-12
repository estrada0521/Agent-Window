    const hubBtn = document.getElementById("pageTitleLink");
    const hubRootUrl = () => `${window.location.origin}/`;
    const hubUrlForPath = (path = "/") => {
      const normalizedPath = normalizeHubPath(path);
      const raw = `${hubRootUrl().replace(/\/$/, "")}${normalizedPath}`;
      try {
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
          requestHubCloseTimeline();
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
