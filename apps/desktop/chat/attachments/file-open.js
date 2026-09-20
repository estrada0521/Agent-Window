__CHAT_INCLUDE:../../../shared/chat/file-link-parse.js__
    const decorateLocalFileLinks = (scope = document) => {
      if (!scope?.querySelectorAll) return;
      const candidates = [];
      scope.querySelectorAll(".md-body a[href]").forEach((anchor) => {
        if (!anchor) return;
        if (anchor.classList.contains("inline-file-link")) return;
        const href = anchor.getAttribute("href") || "";
        const path = normalizeWorkspaceFilePath(pathFromLocalHref(href));
        if (!path) return;
        candidates.push({ anchor, path, href });
      });
      if (!candidates.length) return;
      void resolveInlineCodeFilePaths(candidates.map((item) => item.path)).then((resolved) => {
        candidates.forEach(({ anchor, path, href }) => {
          if (!anchor.isConnected) return;
          const resolvedPath = resolved.get(path) || "";
          if (!resolvedPath) return;
          anchor.classList.add("local-file-link");
          if (/^file:/i.test(href.trim())) anchor.dataset.fileLinkOpen = "editor";
          anchor.dataset.filepath = resolvedPath;
          anchor.dataset.ext = extFromPath(resolvedPath);
          if (!anchor.title) anchor.title = resolvedPath;
          if (!anchor.querySelector("code") && anchor.childElementCount === 0) {
            const label = document.createElement("code");
            label.textContent = anchor.textContent || resolvedPath;
            anchor.replaceChildren(label);
          }
          appendInlineFileLinkIcon(anchor, resolvedPath);
        });
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
    const postOpenDiff = async (path) => {
      const res = await fetch("/open-diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        let detail = "Failed to open diff tool.";
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
      await openFile(normalizedPath);
    };
