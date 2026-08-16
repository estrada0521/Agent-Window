    const showFileAutocompleteLoading = () => {
      fileDrop.innerHTML = `<div class="file-dropdown-loading">${loadingIndicatorHtml("Searching files…")}</div>`;
      _dropActiveIdx = -1;
      positionComposerDropdown(fileDrop);
      if (!fileDrop.classList.contains("visible")) {
        if (_dropTimeout) { clearTimeout(_dropTimeout); _dropTimeout = null; }
        fileDrop.classList.remove("closing");
        fileDrop.style.display = "block";
        fileDrop.classList.add("visible");
      }
    };
    const _basenameCache = new Map();
    const BASENAME_CACHE_MAX = 65536;
    const basename = (path) => {
      const s = String(path || "");
      const cachedBase = _basenameCache.get(s);
      if (cachedBase !== undefined) return cachedBase;
      const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
      const b = i === -1 ? s : s.slice(i + 1);
      if (_basenameCache.size >= BASENAME_CACHE_MAX) _basenameCache.clear();
      _basenameCache.set(s, b);
      return b;
    };
    const composerAutocompleteRelativeDir = (fullPath) => {
      let p = String(fullPath || "").trim().replace(/\\/g, "/");
      for (let i = 0; i < 8; i += 1) {
        const next = p.replace(/\/+/g, "/");
        if (next === p) break;
        p = next;
      }
      p = p.replace(/^\/+/, "").replace(/\/+$/g, "");
      if (!p.includes("/")) return "";
      const idx = p.lastIndexOf("/");
      return idx > 0 ? p.slice(0, idx) : "";
    };
    const fileExtForPath = (path) => {
      const base = basename(path);
      const dot = base.lastIndexOf(".");
      return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
    };
    const formatFileSize = (size) => {
      const value = Number(size);
      if (!Number.isFinite(value) || value < 0) return "";
      if (value >= 1024 * 1024) {
        const mb = value / (1024 * 1024);
        return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1).replace(/\.0$/, "")} MB`;
      }
      if (value === 0) return "0 KB";
      const kb = value / 1024;
      return `${kb >= 10 ? kb.toFixed(0) : kb.toFixed(1).replace(/\.0$/, "")} KB`;
    };
    const parseInlineCodeFileToken = (rawValue) => {
      let token = String(rawValue || "").trim();
      if (!token) return null;
      token = token
        .replace(/^[`"'([{<]+/, "")
        .replace(/[`"')\]}>.,;:!?]+$/g, "")
        .replace(/[、。]+$/g, "")
        .trim();
      if (!token || token.length > 220) return null;
      if (token.startsWith("@")) token = token.slice(1).trim();
      if (!token) return null;
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token) && !token.toLowerCase().startsWith("file://")) return null;
      if (token.toLowerCase().startsWith("file://")) {
        try {
          token = decodeURIComponent(new URL(token).pathname || "").trim();
        } catch (_) {
          return null;
        }
      }
      token = token.replace(/\\/g, "/");
      let line = 0;
      const lineMatch = token.match(/^(.*?)(?:#L(\d+)|:(\d+)|\s+line\s+(\d+)|\s+L(\d+))$/i);
      if (lineMatch && lineMatch[1]) {
        const parsedLine = parseInt(lineMatch[2] || lineMatch[3] || lineMatch[4] || lineMatch[5] || "0", 10);
        if (parsedLine > 0) {
          token = lineMatch[1].trim();
          line = parsedLine;
        }
      }
      token = token.replace(/^\.\/+/, "").trim();
      if (!token || token === "." || token === ".." || /\s/.test(token)) return null;
      return { token, line };
    };
