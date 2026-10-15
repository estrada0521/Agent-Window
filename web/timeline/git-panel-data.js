    const GIT_PANEL_BATCH = 50;
    const GIT_PANEL_FETCH_MS = 5000;
    const gitStatusLinesDigest = (data) => {
      return [...data.status_lines].sort().join("\n");
    };
    const gitOverviewFingerprint = (data) => [
      data.worktree_changed_paths,
      data.worktree_added,
      data.worktree_deleted,
      data.worktree_staged_changed_paths,
      data.worktree_staged_added,
      data.worktree_staged_deleted,
      data.worktree_unstaged_changed_paths,
      data.worktree_unstaged_added,
      data.worktree_unstaged_deleted,
      data.worktree_has_diff ? "1" : "0",
      data.total_commits,
      data.recent_commits.map((commit) =>
        [
          commit.hash,
          commit.subject,
          commit.ins,
          commit.dels,
          commit.is_origin_main ? "1" : "0",
        ].join(":")
      ).join(","),
      gitStatusLinesDigest(data),
    ].join("|");
    const gitOverviewQuery = ({ offset = 0, limit = GIT_PANEL_BATCH, summary = false } = {}) => {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
      });
      if (summary) params.set("summary", "1");
      return params;
    };
    let gitRepositories = [];
    let gitAllWorktrees = [];
    const gitRepository = () => gitAllWorktrees.find((tree) => tree.path === gitTree())?.repo || "";
    const gitTreeLabel = (branch) => gitRepository() ? `${gitRepository()} · ${branch}` : branch;
    const setGitRepository = (repo) => {
      const main = gitAllWorktrees.find((tree) => tree.repo === repo);
      setGitTree(main?.path || "");
    };
    const gitTreeStorageKey = `agent_window_git_tree:${TIMELINE_BASE_PATH}`;
    const gitTree = () => sessionStorage.getItem(gitTreeStorageKey) || "";
    const gitFollowStorageKey = `agent_window_git_follow:${TIMELINE_BASE_PATH}`;
    const gitFollow = () => sessionStorage.getItem(gitFollowStorageKey) !== "0";
    let gitFollowRevision = 0;
    const setGitFollow = async (on) => {
      const revision = ++gitFollowRevision;
      sessionStorage.setItem(gitFollowStorageKey, on ? "1" : "0");
      document.dispatchEvent(new CustomEvent("git-follow-changed"));
      if (!on) return;
      try {
        const { worktrees, followTree } = await fetchGitWorktreeState();
        if (revision !== gitFollowRevision || !gitFollow()) return;
        if (followTree !== null && followTree !== gitTree()) applyFollowTree(followTree, worktrees);
      } catch (err) {
        if (revision === gitFollowRevision) setError("Follow failed", err);
      }
    };
    const applyFollowTree = (tree, worktrees) => {
      const branch = worktrees.find((item) => item.path === tree)?.branch;
      if (branch) {
        const notice = document.createElement("span");
        notice.className = "hud-worktree";
        notice.innerHTML = GIT_WORKTREE_SVG;
        const repo = worktrees.find((item) => item.path === tree)?.repo;
        notice.append(repo ? `${repo} · ${branch}` : branch);
        setStatus(notice);
      }
      setGitTree(tree, { preserveFollow: true });
    };
    const setGitTree = (tree, { preserveFollow = false } = {}) => {
      if (!preserveFollow) setGitFollow(false);
      if (tree) sessionStorage.setItem(gitTreeStorageKey, tree);
      else sessionStorage.removeItem(gitTreeStorageKey);
      document.dispatchEvent(new CustomEvent("git-tree-changed"));
    };
    const gitTreePath = (rel) => (gitTree() ? `${gitTree()}/${rel}` : rel);
    const withGitTree = (url) => {
      const tree = gitTree();
      return tree ? `${url}${url.includes("?") ? "&" : "?"}tree=${encodeURIComponent(tree)}` : url;
    };
    const failIfGitTreeRemoved = (res) => {
      if (res.status !== 404 || !gitTree()) return;
      setGitTree("", { preserveFollow: true });
      setStatus("Worktree removed");
      throw new Error("Worktree removed");
    };
    const fetchGitWorktreeState = async () => {
      const res = await fetchWithTimeout("/git-worktrees", {}, GIT_PANEL_FETCH_MS);
      if (!res.ok) throw new Error((await res.json()).error || "Failed to load worktrees");
      const data = await res.json();
      gitRepositories = data.repositories;
      gitAllWorktrees = data.worktrees;
      if (gitTree() && !gitAllWorktrees.some((tree) => tree.path === gitTree())) {
        setGitTree("", { preserveFollow: true });
      }
      return data;
    };
    const fetchGitWorktrees = async () => {
      await fetchGitWorktreeState();
      return gitAllWorktrees.filter((tree) => tree.repo === gitRepository());
    };
    const fetchGitOverview = async ({ offset = 0, limit = GIT_PANEL_BATCH, summary = false } = {}) => {
      const res = await fetchWithTimeout(
        withGitTree(`/git-overview?${gitOverviewQuery({ offset, limit, summary })}`),
        {},
        GIT_PANEL_FETCH_MS,
      );
      if (!res.ok) {
        failIfGitTreeRemoved(res);
        const error = (await res.json()).error;
        throw new Error(error || (offset > 0 ? "Failed to load more commits" : "Failed to load git overview"));
      }
      return res.json();
    };
    const gitOverviewPagingFromResponse = (data, previousCommits = [], { reset = false } = {}) => {
      const pageCommits = data.recent_commits;
      const commits = reset ? pageCommits.slice() : previousCommits.concat(pageCommits);
      return {
        pageCommits,
        commits,
        nextOffset: data.next_offset,
        hasMore: data.has_more,
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
          entry?.old_path || "",
          entry?.ins ?? "",
          entry?.dels ?? "",
          entry?.untracked ? "1" : "0",
        ].join("\u001f"))
      ).join("\n");
    const fetchGitJson = async (url, options = {}) => {
      const res = await fetchWithTimeout(withGitTree(url), options, GIT_PANEL_FETCH_MS);
      if (!res.ok) {
        failIfGitTreeRemoved(res);
        throw new Error("Failed to load git files");
      }
      return res.json();
    };
    const gitCommitInfos = new Map();
    const gitCommitInfo = (hash, repo) => {
      const key = `${repo ?? gitRepository()}:${hash}`;
      const url = `/git-commit-info?hash=${encodeURIComponent(hash)}`;
      if (!gitCommitInfos.has(key)) {
        const request = repo === undefined ? fetchGitJson(url) : fetchWithTimeout(`${url}&repo=${encodeURIComponent(repo)}`, {}, GIT_PANEL_FETCH_MS).then(async (res) => {
          if (!res.ok) throw new Error((await res.json()).error);
          return res.json();
        });
        gitCommitInfos.set(key, request.catch((err) => {
          gitCommitInfos.delete(key);
          throw err;
        }));
      }
      return gitCommitInfos.get(key);
    };
    const fetchGitWorktreeFileSections = async () => {
      const [stagedData, unstagedData, untrackedData] = await Promise.all([
        fetchGitJson("/git-diff-files?scope=staged"),
        fetchGitJson("/git-diff-files?scope=unstaged"),
        fetchGitJson("/git-diff-files?scope=untracked"),
      ]);
      const sections = [
        { title: "Staged", kind: "staged", files: stagedData.files },
        { title: "Unstaged", kind: "unstaged", files: unstagedData.files },
        { title: "Untracked", kind: "untracked", files: untrackedData.files },
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
      return data;
    };
    const loadGitDiffFileStats = async ({ hash = "", scope = "" } = {}) => {
      if (!hash && !scope) {
        const loaded = await fetchGitWorktreeFileSections();
        return { mode: "sections", ...loaded };
      }
      const data = await fetchGitDiffFiles({ hash, scope });
      return { mode: "list", files: data.files, data };
    };
    const gitFileStatsRowKey = (scope, entry) => `${String(scope || "")}\u001f${String(entry?.path || "").trim()}\u001f${String(entry?.old_path || "").trim()}`;
    const gitCssEscape = (value) => {
      if (window.CSS?.escape) return CSS.escape(String(value || ""));
      return String(value || "").replace(/["\\]/g, "\\$&");
    };
    const updateGitFileStatsRow = (row, entry) => {
      if (!row) return;
      const isUntracked = !!entry?.untracked;
      if (isUntracked) {
        row.dataset.untracked = "1";
      } else {
        delete row.dataset.untracked;
      }
      const [insEl, delsEl] = row.querySelectorAll(".git-commit-file-meta .git-summary-count");
      const updates = [
        { el: insEl, prev: Number(insEl.dataset.countValue), value: entry.ins },
        { el: delsEl, prev: Number(delsEl.dataset.countValue), value: entry.dels },
      ];
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
          const key = gitFileStatsRowKey(section.kind, { path: row.dataset.path || "", old_path: row.dataset.oldPath || "" });
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
