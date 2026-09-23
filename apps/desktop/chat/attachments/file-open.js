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
        let detail = "Open failed";
        try {
          const data = await res.json();
          if (data && data.error) detail = data.error;
        } catch (_) {}
        const err = new Error(detail);
        err.status = res.status;
        throw err;
      }
    };
    const postOpenDiff = async (path, hash = "", oldPath = "") => {
      const res = await fetch("/open-diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, hash, old_path: oldPath }),
      });
      if (!res.ok) {
        let detail = "Diff failed";
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
          : err?.message || "Open failed";
        setStatus(message);
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
