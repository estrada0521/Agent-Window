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
        const err = new Error(detail);
        err.status = res.status;
        throw err;
      }
    };
    const openFile = async (path) => {
      const normalizedPath = normalizeWorkspaceFilePath(path);
      if (!normalizedPath) return false;
      try {
        await postOpenFile(normalizedPath);
        return true;
      } catch (err) {
        const message = err?.status === 404
          ? `file not found: ${displayAttachmentFilename(normalizedPath) || normalizedPath}`
          : err?.message || "Failed to open file in the default app.";
        setStatus(message, true);
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
      await openFile(normalizedPath);
    };
