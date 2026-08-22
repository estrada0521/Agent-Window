    const extFromPath = (path) => {
      const cleanPath = String(path || "").split(/[?#]/, 1)[0];
      const filename = cleanPath.split("/").pop() || "";
      if (!filename.includes(".")) return "";
      return filename.split(".").pop().toLowerCase();
    };
    const localFilePathWithoutLocation = (path) => {
      const rawPath = String(path || "").trim();
      const match = rawPath.match(/^(.+?):[1-9]\d*(?::[1-9]\d*)?$/);
      return match ? match[1] : rawPath;
    };
    const pathFromLocalHref = (href) => {
      const rawHref = String(href || "").trim();
      if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("//")) return "";
      try {
        const url = new URL(rawHref, window.location.href);
        if (url.protocol === "file:" && (!url.host || url.host === "localhost")) {
          return localFilePathWithoutLocation(decodeURIComponent(url.pathname || ""));
        }
        if (url.origin === window.location.origin && ((CHAT_BASE_PATH && (url.pathname === `${CHAT_BASE_PATH}/file-raw` || url.pathname === `${CHAT_BASE_PATH}/file-view`)) || url.pathname === "/file-raw" || url.pathname === "/file-view")) {
          return url.searchParams.get("path") || "";
        }
      } catch (_) {}
      if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref)) return "";
      if (rawHref.startsWith("/")) {
        if (/^\/(Users|private|var|tmp)\//.test(rawHref)) return localFilePathWithoutLocation(rawHref.split(/[?#]/, 1)[0]);
        return "";
      }
      const cleanHref = rawHref.split(/[?#]/, 1)[0];
      if (!cleanHref.includes("/")) return "";
      return localFilePathWithoutLocation(cleanHref);
    };
