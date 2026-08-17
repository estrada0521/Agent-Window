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
      data?.worktree_fingerprint ?? "",
      data?.worktree_has_diff ? "1" : "0",
      data?.total_commits ?? "",
      (Array.isArray(data?.recent_commits) ? data.recent_commits : []).map((commit) =>
        [commit?.hash || "", commit?.subject || "", commit?.ins ?? "", commit?.dels ?? ""].join(":")
      ).join(","),
      gitStatusLinesDigest(data),
    ].join("|");
    const gitOverviewQuery = ({ offset = 0, limit = GIT_PANEL_BATCH, refresh = false } = {}) => {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
      });
      if (refresh) params.set("refresh", "1");
      return params;
    };
    const fetchGitOverview = async ({ offset = 0, limit = GIT_PANEL_BATCH, refresh = false } = {}) => {
      const res = await fetchWithTimeout(
        `/git-overview?${gitOverviewQuery({ offset, limit, refresh })}`,
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
