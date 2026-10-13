    const loadFileSearchMatches = async (rawQuery, limit) => {
      const query = String(rawQuery || "").trim();
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        params.set("limit", String(limit));
        const response = await fetchWithTimeout(`/files-search?${params.toString()}`, {}, 2500);
        if (response.ok) {
          return await response.json();
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
      if (!res.ok) {
        const message = (await res.json().catch(() => ({}))).error || "Failed to load directory";
        if (path && res.status === 404 && message === "Directory not found") {
          return { ...await fetchRepoDir(""), missingPath: path };
        }
        throw new Error(message);
      }
      const { entries } = await res.json();
      entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
      return { path, entries };
    };
