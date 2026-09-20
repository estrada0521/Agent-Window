    const fileIconThemeState = {
      ready: false,
      inline: false,
      theme: null,
      loadPromise: null,
    };

    const mergeFileIconAssociations = (base, overlay) => {
      if (!overlay || typeof overlay !== "object") return base;
      return {
        file: overlay.file || base.file,
        folder: overlay.folder || base.folder,
        fileExtensions: { ...(base.fileExtensions || {}), ...(overlay.fileExtensions || {}) },
        fileNames: { ...(base.fileNames || {}), ...(overlay.fileNames || {}) },
        folderNames: { ...(base.folderNames || {}), ...(overlay.folderNames || {}) },
      };
    };

    const activeFileIconAssociations = () => {
      const theme = fileIconThemeState.theme || {};
      let associations = {
        file: theme.file || "file",
        folder: theme.folder || "folder",
        fileExtensions: theme.fileExtensions || {},
        fileNames: theme.fileNames || {},
        folderNames: theme.folderNames || {},
      };
      const isLight = document.documentElement.dataset.theme === "light";
      if (isLight && theme.light) associations = mergeFileIconAssociations(associations, theme.light);
      return associations;
    };

    const resolveFileIconDefinitionId = (rawPath, { isDir = false } = {}) => {
      const associations = activeFileIconAssociations();
      const definitions = fileIconThemeState.theme?.iconDefinitions || {};
      const has = (id) => id && definitions[id];
      const basename = String(rawPath || "").replace(/\\/g, "/").split("/").pop() || "";
      const lowerName = basename.toLowerCase();
      if (isDir) {
        const byName = associations.folderNames?.[lowerName];
        if (has(byName)) return byName;
        if (has(associations.folder)) return associations.folder;
        return "folder";
      }
      const byFileName = associations.fileNames?.[lowerName];
      if (has(byFileName)) return byFileName;
      if (lowerName.includes(".")) {
        const parts = lowerName.split(".");
        for (let i = 1; i < parts.length; i += 1) {
          const ext = parts.slice(i).join(".");
          const byExt = associations.fileExtensions?.[ext];
          if (has(byExt)) return byExt;
        }
      }
      if (has(associations.file)) return associations.file;
      return "file";
    };

    const fileIconHtml = (rawPath, { isDir = false, classNames = "" } = {}) => {
      if (!fileIconThemeState.ready) {
        throw new Error("file icon theme is not ready");
      }
      const iconId = resolveFileIconDefinitionId(rawPath, { isDir });
      const def = fileIconThemeState.theme?.iconDefinitions?.[iconId] || {};
      const classes = ["file-icon", classNames].filter(Boolean).join(" ");
      if (fileIconThemeState.inline && def.svg) {
        return `<span class="${classes}" aria-hidden="true">${def.svg}</span>`;
      }
      const url = withChatBase(def.iconPath || `/file-icon-theme/icon/${encodeURIComponent(iconId)}`);
      return `<span class="${classes}" aria-hidden="true"><img src="${escapeHtml(url)}" alt=""></span>`;
    };

    const fileIconElement = (rawPath, opts = {}, classNames = "") => {
      const host = document.createElement("div");
      host.innerHTML = fileIconHtml(rawPath, { ...opts, classNames });
      return host.firstElementChild || host;
    };

    const appendInlineFileLinkIcon = (anchor, path = "") => {
      if (!anchor || !fileIconThemeState.ready) return;
      if (anchor.querySelector(".inline-file-link-icon")) return;
      const normalized = String(path || anchor.dataset?.filepath || "").trim();
      if (!normalized) return;
      const icon = fileIconElement(normalized, {}, "inline-file-link-icon");
      const codeEl = anchor.querySelector("code");
      if (codeEl) anchor.insertBefore(icon, codeEl);
      else anchor.prepend(icon);
    };

    const decorateInlineFileLinkIcons = (scope = document) => {
      if (!fileIconThemeState.ready || !scope?.querySelectorAll) return;
      scope.querySelectorAll("a.inline-file-link, a.local-file-link").forEach((anchor) => {
        appendInlineFileLinkIcon(anchor);
      });
    };

    const applyFileIconThemePayload = (payload) => {
      if (!payload?.theme || typeof payload.theme !== "object") {
        throw new Error("file icon theme payload is missing theme");
      }
      fileIconThemeState.theme = payload.theme;
      fileIconThemeState.inline = payload.inline;
      fileIconThemeState.ready = true;
      decorateInlineFileLinkIcons(document);
      return fileIconThemeState;
    };

    const ensureFileIconTheme = () => {
      if (fileIconThemeState.ready) return Promise.resolve(fileIconThemeState);
      if (fileIconThemeState.loadPromise) return fileIconThemeState.loadPromise;
      const boot = window.__FILE_ICON_THEME__;
      if (boot?.theme && typeof boot.theme === "object") {
        applyFileIconThemePayload(boot);
        return Promise.resolve(fileIconThemeState);
      }
      fileIconThemeState.loadPromise = fetch(withChatBase("/file-icon-theme"))
        .then((res) => {
          if (!res.ok) throw new Error(`file icon theme HTTP ${res.status}`);
          return res.json();
        })
        .then((payload) => applyFileIconThemePayload(payload))
        .catch((err) => {
          fileIconThemeState.loadPromise = null;
          throw err;
        });
      return fileIconThemeState.loadPromise;
    };

    void ensureFileIconTheme();
