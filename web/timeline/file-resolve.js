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
    const loadFileSearchMatches = async (rawQuery, limit) => {
      const query = String(rawQuery || "").trim();
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        params.set("limit", String(limit));
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
      const response = await fetch("/files-resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: unique }),
      });
      const { resolved } = await response.json();
      const out = new Map();
      for (const query of unique) {
        if (resolved[query]) out.set(query, resolved[query]);
      }
      return out;
    };
    const fetchRepoDir = async (path) => {
      const res = await fetchWithTimeout(`/files-dir?path=${encodeURIComponent(path)}`, {}, 12000);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load directory");
      const { entries } = await res.json();
      return entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
    };
