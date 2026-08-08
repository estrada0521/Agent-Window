    let currentBoldModeMobile = false;
    const _fileExistenceCache = new Map();
__CHAT_INCLUDE:../../../../shared/chat/file-link-parse.js__
    const decorateLocalFileLinks = (scope = document) => {
      if (!scope?.querySelectorAll) return;
      scope.querySelectorAll(".md-body a[href]").forEach((anchor) => {
        if (!anchor) return;
        const href = anchor.getAttribute("href") || "";
        const path = normalizeWorkspaceFilePath(pathFromLocalHref(href));
        if (!path) return;
        anchor.classList.add("local-file-link");
        if (/^file:/i.test(href.trim())) anchor.dataset.fileLinkOpen = "editor";
        if (!anchor.dataset.filepath) anchor.dataset.filepath = path;
        if (!anchor.dataset.ext) anchor.dataset.ext = extFromPath(path);
        if (!anchor.title) anchor.title = path;
        if (!anchor.querySelector("code") && anchor.childElementCount === 0) {
          const label = document.createElement("code");
          label.textContent = anchor.textContent || path;
          anchor.replaceChildren(label);
        }
      });
    };
    const filePathFromLinkAnchor = (anchor) => {
      if (!anchor) return "";
      const fromDataset = String(anchor.dataset?.filepath || "").trim();
      const raw = fromDataset || pathFromLocalHref(anchor.getAttribute("href") || "");
      return normalizeWorkspaceFilePath(raw);
    };
__CHAT_INCLUDE:../../../../shared/chat/file-link-line.js__
    const fileExistsOnDisk = async (path) => {
      const normalizedPath = normalizeWorkspaceFilePath(path);
      if (!normalizedPath) return false;
      const cached = _fileExistenceCache.get(normalizedPath);
      try {
        const res = await fetch("/files-exist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: [normalizedPath] }),
        });
        if (!res.ok) {
          return cached === true;
        }
        const data = await res.json().catch(() => ({}));
        const exists = !!data?.[normalizedPath];
        if (exists) {
          _fileExistenceCache.set(normalizedPath, true);
        } else {
          _fileExistenceCache.delete(normalizedPath);
        }
        return exists;
      } catch (_) {
        return cached === true;
      }
    };
    const openFileInEditor = async (path, line = 0) => {
      const normalizedPath = normalizeWorkspaceFilePath(path);
      if (!normalizedPath) return false;
      const normalizedLine = Number.isFinite(line) && line > 0 ? Math.floor(line) : 0;
      const payload = { path: normalizedPath, line: normalizedLine };
      const tryPost = () =>
        fetch("/open-file-in-editor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      try {
        let res = await tryPost();
        if (!res.ok && (res.status >= 500 || res.status === 429)) {
          await delay(220);
          res = await tryPost();
        }
        if (!res.ok) {
          let detail = "Failed to open file in the default app.";
          try {
            const data = await res.json();
            if (data && data.error) detail = data.error;
          } catch (_) {}
          throw new Error(detail);
        }
        return true;
      } catch (err) {
        try {
          _fileExistenceCache.delete(normalizedPath);
        } catch (_) {}
        setStatus(err?.message || "Failed to open file in the default app.", true);
        setTimeout(() => setStatus(""), 2200);
        return false;
      }
    };
    let _openSurfaceChain = Promise.resolve();
    const runOpenSurfaceSerialized = (fn) => {
      const next = _openSurfaceChain.then(fn).catch(() => {});
      _openSurfaceChain = next;
      return next;
    };
    const openFileSurface = (path, ext, sourceEl, triggerEvent, lineArg = 0) =>
      runOpenSurfaceSerialized(() => openFileSurfaceImpl(path, ext, sourceEl, triggerEvent, lineArg));
    const openFileSurfaceImpl = async (path, ext, sourceEl, triggerEvent, lineArg = 0) => {
      const normalizedPath = normalizeWorkspaceFilePath(path);
      if (!normalizedPath) return;
      const lineNum = Number.isFinite(lineArg) && lineArg > 0 ? Math.floor(lineArg) : 0;
      if (isPublicChatView) {
        window.open(fileViewHrefForPath(normalizedPath), "_blank", "noopener,noreferrer");
        return;
      }
      const exists = await fileExistsOnDisk(normalizedPath);
      if (!exists) {
        setStatus(`file not found: ${displayAttachmentFilename(normalizedPath) || normalizedPath}`, true);
        setTimeout(() => setStatus(""), 2200);
        return;
      }
      await openFileInEditor(normalizedPath, lineNum);
    };
