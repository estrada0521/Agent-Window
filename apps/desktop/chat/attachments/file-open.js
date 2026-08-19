    const _fileExistenceCache = new Map();
__CHAT_INCLUDE:../../../shared/chat/file-link-parse.js__
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
        if (!res.ok) return false;
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
    const postOpenFile = async (path) => {
      const tryPost = () =>
        fetch("/open-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
      let res = await tryPost();
      if (!res.ok && (res.status >= 500 || res.status === 429)) {
        await new Promise((r) => setTimeout(r, 220));
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
    };
    const openFile = async (path) => {
      const normalizedPath = normalizeWorkspaceFilePath(path);
      if (!normalizedPath) return false;
      try {
        await postOpenFile(normalizedPath);
        return true;
      } catch (err) {
        try {
          _fileExistenceCache.delete(normalizedPath);
        } catch (_) {}
        setStatus(err?.message || "Failed to open file in the default app.", true);
        setTimeout(() => setStatus(""), STATUS_TOAST_MS);
        return false;
      }
    };
    let _openSurfaceChain = Promise.resolve();
    const runOpenSurfaceSerialized = (fn) => {
      const next = _openSurfaceChain.then(fn).catch(() => {});
      _openSurfaceChain = next;
      return next;
    };
    const openFileSurface = (path, ext, sourceEl, triggerEvent) =>
      runOpenSurfaceSerialized(() => openFileSurfaceImpl(path, ext, sourceEl, triggerEvent));
    const openFileSurfaceImpl = async (path, ext, sourceEl, triggerEvent) => {
      const normalizedPath = normalizeWorkspaceFilePath(path);
      if (!normalizedPath) return;
      if (isPublicChatView) {
        window.open(fileViewHrefForPath(normalizedPath), "_blank", "noopener,noreferrer");
        return;
      }
      const exists = await fileExistsOnDisk(normalizedPath);
      if (!exists) {
        setStatus(`file not found: ${displayAttachmentFilename(normalizedPath) || normalizedPath}`, true);
        setTimeout(() => setStatus(""), STATUS_TOAST_MS);
        return;
      }
      await openFile(normalizedPath);
    };
