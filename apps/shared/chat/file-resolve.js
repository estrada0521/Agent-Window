    const normalizeFileEntry = (entry) => {
      if (!entry) return null;
      if (typeof entry === "string") return { path: entry, size: null };
      const path = typeof entry.path === "string" ? entry.path : "";
      if (!path) return null;
      let size = null;
      if (Object.prototype.hasOwnProperty.call(entry, "size")) {
        const rawSize = entry.size;
        if (rawSize !== null && rawSize !== undefined && rawSize !== "") {
          const parsedSize = Number(rawSize);
          if (Number.isFinite(parsedSize) && parsedSize >= 0) {
            size = parsedSize;
          }
        }
      }
      return { path, size };
    };
    const loadFileSearchMatches = async (rawQuery, limit = 30) => {
      const query = String(rawQuery || "").trim();
      const normalizedLimit = Math.max(1, Math.min(120, Number(limit) || 30));
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        params.set("limit", String(normalizedLimit));
        const response = await fetchWithTimeout(`/files-search?${params.toString()}`, {}, 2500);
        if (response.ok) {
          const raw = await response.json();
          return (Array.isArray(raw) ? raw : [])
            .map(normalizeFileEntry)
            .filter(Boolean);
        }
      } catch (_) { }
      return [];
    };
    const resolveInlineCodeFilePaths = async (queries) => {
      const unique = [...new Set((Array.isArray(queries) ? queries : []).map((item) => String(item || "").trim()).filter(Boolean))];
      if (!unique.length) return new Map();
      try {
        const response = await fetch("/files-resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queries: unique }),
        });
        const payload = response.ok ? await response.json() : null;
        const resolved = payload && typeof payload === "object" ? payload.resolved : null;
        const out = new Map();
        for (const query of unique) {
          const path = resolved && typeof resolved[query] === "string" ? resolved[query] : "";
          if (path) out.set(query, path);
        }
        return out;
      } catch (_) {
        return new Map();
      }
    };
