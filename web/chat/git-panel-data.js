    const GIT_PANEL_BATCH = 50;
    const GIT_PANEL_FETCH_MS = 5000;
    const gitStatusLinesDigest = (data) => {
      const lines = Array.isArray(data?.status_lines) ? data.status_lines : [];
      return lines.map((s) => String(s || "")).sort().join("\n");
    };
    const gitOverviewFingerprint = (data) => [
      data?.worktree_changed_paths ?? "",
      data?.worktree_added ?? "",
      data?.worktree_deleted ?? "",
      data?.worktree_staged_changed_paths ?? "",
      data?.worktree_staged_added ?? "",
      data?.worktree_staged_deleted ?? "",
      data?.worktree_unstaged_changed_paths ?? "",
      data?.worktree_unstaged_added ?? "",
      data?.worktree_unstaged_deleted ?? "",
      data?.worktree_has_diff ? "1" : "0",
      data?.total_commits ?? "",
      (Array.isArray(data?.recent_commits) ? data.recent_commits : []).map((commit) =>
        [
          commit?.hash || "",
          commit?.subject || "",
          commit?.ins ?? "",
          commit?.dels ?? "",
          commit?.is_origin_main ? "1" : "0",
        ].join(":")
      ).join(","),
      gitStatusLinesDigest(data),
    ].join("|");
    const gitOverviewQuery = ({ offset = 0, limit = GIT_PANEL_BATCH, refresh = false, summary = false } = {}) => {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
      });
      if (refresh) params.set("refresh", "1");
      if (summary) params.set("summary", "1");
      return params;
    };
    const fetchGitOverview = async ({ offset = 0, limit = GIT_PANEL_BATCH, refresh = false, summary = false } = {}) => {
      const res = await fetchWithTimeout(
        `/git-overview?${gitOverviewQuery({ offset, limit, refresh, summary })}`,
        {},
        GIT_PANEL_FETCH_MS,
      );
      if (!res.ok) {
        if (refresh && !offset) throw new Error("Failed to refresh git overview");
        throw new Error(offset > 0 ? "Failed to load more commits" : "Failed to load git overview");
      }
      return res.json();
    };
    const gitOverviewPagingFromResponse = (data, previousCommits = [], { reset = false } = {}) => {
      const pageCommits = Array.isArray(data?.recent_commits) ? data.recent_commits : [];
      const commits = reset ? pageCommits.slice() : previousCommits.concat(pageCommits);
      return {
        pageCommits,
        commits,
        totalCommits: Math.max(0, parseInt(data?.total_commits) || 0),
        nextOffset: Math.max(0, parseInt(data?.next_offset) || commits.length),
        hasMore: !!data?.has_more,
        fingerprint: gitOverviewFingerprint(data),
      };
    };
    const gitNewCommitHashes = (previousCommits, nextCommits) => {
      if (!previousCommits?.length || !Array.isArray(nextCommits) || !nextCommits.length) return null;
      const oldHashes = new Set(previousCommits.map((commit) => commit.hash));
      const added = new Set();
      for (const commit of nextCommits) {
        if (!oldHashes.has(commit.hash)) added.add(commit.hash);
      }
      return added.size ? added : null;
    };
    const gitFileStatsRowsSignature = (sections) =>
      (sections || []).flatMap((section) =>
        (section.files || []).map((entry) => [
          section.kind || "",
          entry?.path || "",
          entry?.ins ?? "",
          entry?.dels ?? "",
          entry?.untracked ? "1" : "0",
        ].join("\u001f"))
      ).join("\n");
    const fetchGitJson = async (url) => {
      const res = await fetchWithTimeout(url, {}, GIT_PANEL_FETCH_MS);
      if (!res.ok) throw new Error("Failed to load git files");
      return res.json();
    };
    const gitCommitInfos = new Map();
    const gitCommitInfo = (hash) => {
      if (!gitCommitInfos.has(hash)) {
        gitCommitInfos.set(hash, fetchGitJson(`/git-commit-info?hash=${encodeURIComponent(hash)}`).catch((err) => {
          gitCommitInfos.delete(hash);
          throw err;
        }));
      }
      return gitCommitInfos.get(hash);
    };
    const fetchGitWorktreeFileSections = async () => {
      const [stagedData, unstagedData, untrackedData] = await Promise.all([
        fetchGitJson("/git-diff-files?scope=staged"),
        fetchGitJson("/git-diff-files?scope=unstaged"),
        fetchGitJson("/git-diff-files?scope=untracked"),
      ]);
      const sections = [
        { title: "Staged", kind: "staged", files: Array.isArray(stagedData?.files) ? stagedData.files : [] },
        { title: "Unstaged", kind: "unstaged", files: Array.isArray(unstagedData?.files) ? unstagedData.files : [] },
        { title: "Untracked", kind: "untracked", files: Array.isArray(untrackedData?.files) ? untrackedData.files : [] },
      ].filter((section) => section.files.length);
      return {
        sections,
        files: sections.flatMap((section) => section.files),
      };
    };
    const fetchGitDiffFiles = async ({ hash = "", scope = "" } = {}) => {
      const params = new URLSearchParams({ hash: String(hash || "") });
      if (!hash && scope) params.set("scope", scope);
      const data = await fetchGitJson(`/git-diff-files?${params.toString()}`);
      const files = Array.isArray(data?.files) ? data.files : [];
      return { ...data, files };
    };
    const loadGitDiffFileStats = async ({ hash = "", scope = "" } = {}) => {
      if (!hash && !scope) {
        const loaded = await fetchGitWorktreeFileSections();
        return { mode: "sections", ...loaded };
      }
      const data = await fetchGitDiffFiles({ hash, scope });
      return { mode: "list", files: data.files, data };
    };
    const gitFileStatsRowKey = (scope, entry) => `${String(scope || "")}\u001f${String(entry?.path || "").trim()}`;
    const gitCssEscape = (value) => {
      if (window.CSS?.escape) return CSS.escape(String(value || ""));
      return String(value || "").replace(/["\\]/g, "\\$&");
    };
    const updateGitFileStatsRow = (row, entry) => {
      if (!row) return;
      const isUntracked = !!entry?.untracked;
      if (isUntracked) {
        row.dataset.untracked = "1";
        return;
      }
      delete row.dataset.untracked;
      const nextIns = Math.max(0, parseInt(entry?.ins) || 0);
      const nextDels = Math.max(0, parseInt(entry?.dels) || 0);
      const countEls = Array.from(row.querySelectorAll(".git-commit-file-meta .git-summary-count"));
      const updates = [
        { idx: 0, value: nextIns },
        { idx: 1, value: nextDels },
      ].map(({ idx, value }) => {
        const el = countEls[idx];
        if (!el) return null;
        const prev = Math.max(0, parseInt(el.dataset.countValue || el.textContent || "0") || 0);
        return { el, prev, value };
      }).filter(Boolean);
      if (updates.some(({ prev, value }) => prev !== value)) {
        const token = String(Date.now());
        row.dataset.statsUpdateToken = token;
        row.classList.add("is-stats-updating");
        window.setTimeout(() => {
          if (row.dataset.statsUpdateToken !== token) return;
          row.classList.remove("is-stats-updating");
          delete row.dataset.statsUpdateToken;
        }, 2000);
      }
      updates.forEach(({ el, prev, value }) => {
        el.dataset.countValue = String(value);
        animateGitCount(el, prev, value);
      });
    };
    const applyGitFileStatsSectionsInto = (wrapEl, sections, {
      allowUndo = false,
      incremental = false,
      emptyHtml = '<div class="git-commit-file-empty sheet-list-empty">No changed files</div>',
      onBeforeFlip = null,
    } = {}) => {
      const safeSections = (sections || []).filter((section) => Array.isArray(section.files) && section.files.length);
      const signature = gitFileStatsRowsSignature(safeSections);
      const fileRowKey = (el) => {
        const path = el.dataset.path || "";
        const scope = el.closest(".git-commit-file-section")?.dataset.scope || "";
        return scope ? `${scope}:${path}` : path;
      };
      const firstRects = captureListRowRects(wrapEl, ".git-commit-file-row", fileRowKey);
      const finishFlip = () => {
        if (typeof onBeforeFlip === "function") onBeforeFlip();
        flipListRows(wrapEl, ".git-commit-file-row", fileRowKey, firstRects);
      };
      if (!safeSections.length) {
        wrapEl.dataset.fileStatsSignature = "";
        wrapEl.innerHTML = emptyHtml;
        return;
      }
      if (!incremental || !wrapEl.querySelector(".git-commit-file-sections")) {
        wrapEl.dataset.fileStatsSignature = signature;
        wrapEl.innerHTML = gitCommitFileStatsSectionsHtml(safeSections, { allowUndo });
        finishFlip();
        return;
      }
      if (wrapEl.dataset.fileStatsSignature === signature) return;

      const desiredScopes = new Set(safeSections.map((section) => section.kind));
      wrapEl.querySelectorAll(".git-commit-file-section").forEach((sectionEl) => {
        if (!desiredScopes.has(sectionEl.dataset.scope || "")) sectionEl.remove();
      });

      const sectionsRoot = wrapEl.querySelector(".git-commit-file-sections");
      if (!sectionsRoot) {
        wrapEl.dataset.fileStatsSignature = signature;
        wrapEl.innerHTML = gitCommitFileStatsSectionsHtml(safeSections, { allowUndo });
        finishFlip();
        return;
      }

      safeSections.forEach((section) => {
        let sectionEl = sectionsRoot.querySelector(`.git-commit-file-section[data-scope="${gitCssEscape(section.kind)}"]`);
        if (!sectionEl) {
          sectionsRoot.insertAdjacentHTML("beforeend", gitCommitFileStatsSectionHtml(section, { allowUndo }));
          return;
        }
        const listEl = sectionEl.querySelector(".git-commit-file-list");
        if (!listEl) {
          sectionEl.outerHTML = gitCommitFileStatsSectionHtml(section, { allowUndo });
          return;
        }
        const desiredKeys = new Set(section.files.map((entry) => gitFileStatsRowKey(section.kind, entry)));
        listEl.querySelectorAll(".git-commit-file-row").forEach((row) => {
          const key = gitFileStatsRowKey(section.kind, { path: row.dataset.path || "" });
          if (!desiredKeys.has(key)) row.remove();
        });
        section.files.forEach((entry) => {
          const selector = `.git-commit-file-row[data-path="${gitCssEscape(String(entry?.path || "").trim())}"]`;
          const existing = listEl.querySelector(selector);
          if (!existing) {
            listEl.insertAdjacentHTML("beforeend", gitCommitFileRowHtml(entry, { allowUndo, scope: section.kind, animate: true }));
          } else {
            updateGitFileStatsRow(existing, entry);
          }
        });
      });
      wrapEl.dataset.fileStatsSignature = signature;
      finishFlip();
    };
