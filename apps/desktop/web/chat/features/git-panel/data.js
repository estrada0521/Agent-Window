    let _dpGitOverviewFingerprint = null;
    let _dpGitRefreshInFlight = false;
    const dpGitStatusLinesDigest = (data) => {
      const lines = Array.isArray(data?.status_lines) ? data.status_lines : [];
      return lines.map((s) => String(s || "")).sort().join("\n");
    };
    const dpGitFingerprint = (data) => [
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
      data?.total_commits ?? "",
      (data?.recent_commits || []).slice(0, 5).map(c => c.hash).join(","),
      dpGitStatusLinesDigest(data),
    ].join("|");
    const dpRefreshGitOverview = async () => {
      if (dpGitPageLoading) return;
      if (!dpPanelOpen && !dpGitSummaryPinned) return;
      if (_dpGitRefreshInFlight) return;
      _dpGitRefreshInFlight = true;
      try {
        const params = new URLSearchParams({ offset: "0", limit: String(DP_GIT_BATCH) });
        params.set("refresh", "1");
        const res = await fetchWithTimeout(`/git-branch-overview?${params}`, {}, 5000);
        if (!res.ok) return;
        const data = await res.json();
        const fp = dpGitFingerprint(data);
        if (fp === _dpGitOverviewFingerprint) return;
        const isFirstRefresh = _dpGitOverviewFingerprint === null;
        _dpGitOverviewFingerprint = fp;

        if (!dpPanelOpen && dpGitSummaryPinned) {
          dpGitHeaderSummaryState = dpBuildSummaryState(data);
          dpApplyGitOverviewHeader();
          return;
        }

        let newHashes = null;
        if (!isFirstRefresh && Array.isArray(data?.recent_commits) && dpGitCommits.length > 0) {
          const oldHashes = new Set(dpGitCommits.map(c => c.hash));
          newHashes = new Set();
          for (const c of data.recent_commits) {
            if (!oldHashes.has(c.hash)) newHashes.add(c.hash);
          }
          if (newHashes.size === 0) newHashes = null;
        }

        dpGitHeaderSummaryState = dpBuildSummaryState(data);
        dpSyncSummaryWrap();
        if (!dpGitDetailContext) {
          dpGitCommits = Array.isArray(data?.recent_commits) ? data.recent_commits.slice() : [];
          dpGitTotalCommits = Math.max(0, parseInt(data?.total_commits) || 0);
          dpGitNextOffset = Math.max(0, parseInt(data?.next_offset) || dpGitCommits.length);
          dpGitHasMore = !!data?.has_more;
          dpRenderCommitRows(dpGitCommits, { append: false, newHashes });
          dpUpdateLoadMoreUi();
          dpEnsureGitObserver();
        } else if (dpGitDetailContext.kind === "worktree" && dpGitDetailContext.wrapEl) {
          void dpRenderFileStatsInto(dpGitDetailContext.wrapEl, "", { allowUndo: true, incremental: true })
            .then(() => {
              if (dpGitDetailContext?.wrapEl && !dpGitDetailContext.wrapEl.querySelector(".git-commit-file-row")) {
                dpCloseGitDetail({ refreshList: true });
              }
            }).catch(() => {});
        }
      } catch (_) {
      } finally {
        _dpGitRefreshInFlight = false;
      }
    };
    const dpToggleGitSummaryPinned = () => {
      dpGitSummaryPinned = !dpGitSummaryPinned;
      try {
        window.localStorage?.setItem(dpGitSummaryPinnedStorageKey(), dpGitSummaryPinned ? "1" : "0");
      } catch (_) {}
      if (dpGitSummaryPinned) {
        if (!dpGitHeaderSummaryState?.rowHtml) void dpBootstrapPinnedGitSummary();
        else dpSyncPinnedSummaryStrip();
      } else {
        dpSyncPinnedSummaryStrip();
      }
    };
    const dpBootstrapPinnedGitSummary = async () => {
      if (!hasDesktopRightPanelOverlay() || !dpGitSummaryPinned) return;
      try {
        const params = new URLSearchParams({ offset: "0", limit: String(DP_GIT_BATCH) });
        const res = await fetchWithTimeout(`/git-branch-overview?${params}`, {}, 5000);
        if (!res.ok) return;
        const data = await res.json();
        dpGitHeaderSummaryState = dpBuildSummaryState(data);
        dpApplyGitOverviewHeader();
        _dpGitOverviewFingerprint = dpGitFingerprint(data);
      } catch (_) {}
    };
    const dpOnSessionSummaryPinReload = ({ force = false } = {}) => {
      const storageKey = dpGitSummaryPinnedStorageKey();
      if (!force && _dpGitSummaryPinnedLoadedForKey === storageKey) return;
      _dpGitSummaryPinnedLoadedForKey = storageKey;
      dpReadGitSummaryPinnedFromStorage();
      _dpGitOverviewFingerprint = null;
      if (dpGitSummaryPinned) {
        void dpBootstrapPinnedGitSummary();
      }
      dpSyncPinnedSummaryStrip();
      dpApplyPanelWidth();
    };
    const dpApplyGitPage = (data, { reset = false, newHashes = null } = {}) => {
      const commits = Array.isArray(data?.recent_commits) ? data.recent_commits : [];
      if (reset) {
        dpRenderGitShell(data || {});
        dpGitCommits = [];
      }
      dpGitHeaderSummaryState = dpBuildSummaryState(data || {});
      _dpGitOverviewFingerprint = dpGitFingerprint(data || {});
      dpSyncSummaryWrap();
      if (commits.length) {
        dpGitCommits = reset ? commits.slice() : dpGitCommits.concat(commits);
      } else if (reset) {
        dpGitCommits = [];
      }
      dpGitTotalCommits = Math.max(0, parseInt(data?.total_commits) || 0);
      dpGitNextOffset = Math.max(0, parseInt(data?.next_offset) || dpGitCommits.length);
      dpGitHasMore = !!data?.has_more;
      if (reset) {
        dpRenderCommitRows(dpGitCommits, { append: false, newHashes });
      } else if (commits.length) {
        dpRenderCommitRows(commits, { append: true });
      }
      dpUpdateLoadMoreUi();
      dpEnsureGitObserver();
    };
    const dpPostOpenFileInEditor = async (rawPath, line = 0, { diff = false, commitHash = "" } = {}) => {
      const normalizedPath = normalizeWorkspaceFilePath(rawPath);
      if (!normalizedPath) return;
      const normalizedLine = Number.isFinite(line) && line > 0 ? Math.floor(line) : 0;
      const payload = { path: normalizedPath, line: normalizedLine };
      if (diff) {
        payload.diff = true;
        payload.commit_hash = String(commitHash || "").trim();
      }
      const tryPost = () => fetch("/open-file-in-editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const okMsg = diff ? `Diff opened: ${normalizedPath}` : `Opened ${normalizedPath}`;
      const errMsg = diff ? "Failed to open diff in editor." : "Failed to open file in editor.";
      try {
        let res = await tryPost();
        if (!res.ok && (res.status >= 500 || res.status === 429)) {
          await sleep(220);
          res = await tryPost();
        }
        if (!res.ok) {
          let detail = errMsg;
          try {
            const data = await res.json();
            if (data?.error) detail = data.error;
          } catch (_) {}
          throw new Error(detail);
        }
        setStatus(okMsg);
        setTimeout(() => setStatus(""), 1800);
      } catch (err) {
        setStatus(err?.message || errMsg, true);
        setTimeout(() => setStatus(""), 2600);
      }
    };
    const dpFileStatsRowKey = (scope, entry) => `${String(scope || "")}\u001f${String(entry?.path || "").trim()}`;
    const dpFileStatsRowsSignature = (sections) =>
      (sections || []).flatMap((section) =>
        (section.files || []).map((entry) => [
          section.kind || "",
          entry?.path || "",
          entry?.ins ?? "",
          entry?.dels ?? "",
          entry?.untracked ? "1" : "0",
        ].join("\u001f"))
      ).join("\n");
    const dpCssEscape = (value) => {
      if (window.CSS?.escape) return CSS.escape(String(value || ""));
      return String(value || "").replace(/["\\]/g, "\\$&");
    };
    const dpBuildFileStatsSectionsHtml = (sections, { allowUndo = false } = {}) =>
      `<div class="git-commit-file-sections">${sections.map((section) => `<section class="git-commit-file-section" data-scope="${escapeHtml(section.kind)}"><div class="git-commit-file-section-title">${escapeHtml(section.title)}</div><div class="git-commit-file-list">${section.files.map((entry) => dpBuildFileRowHtml(entry, { allowUndo, scope: section.kind })).join("")}</div></section>`).join("")}</div>`;
    const dpBuildFileStatsSectionHtml = (section, { allowUndo = false } = {}) =>
      `<section class="git-commit-file-section" data-scope="${escapeHtml(section.kind)}"><div class="git-commit-file-section-title">${escapeHtml(section.title)}</div><div class="git-commit-file-list">${section.files.map((entry) => dpBuildFileRowHtml(entry, { allowUndo, scope: section.kind })).join("")}</div></section>`;
    const dpUpdateFileStatsRow = (row, entry) => {
      if (!row) return;
      const isUntracked = !!entry?.untracked;
      if (isUntracked) {
        row.dataset.untracked = "1";
        return;
      }
      delete row.dataset.untracked;
      const nextIns = Math.max(0, parseInt(entry?.ins) || 0);
      const nextDels = Math.max(0, parseInt(entry?.dels) || 0);
      const countEls = Array.from(row.querySelectorAll(".git-commit-file-meta .git-branch-summary-count"));
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
        dpAnimateGitCount(el, prev, value);
      });
    };
    const dpApplyFileStatsSectionsInto = (wrapEl, sections, { allowUndo = false, incremental = false } = {}) => {
      const safeSections = (sections || []).filter((section) => Array.isArray(section.files) && section.files.length);
      const signature = dpFileStatsRowsSignature(safeSections);
      if (!safeSections.length) {
        wrapEl.dataset.fileStatsSignature = "";
        wrapEl.innerHTML = '<div class="git-commit-file-empty">No changed files</div>';
        return;
      }
      if (!incremental || !wrapEl.querySelector(".git-commit-file-sections")) {
        wrapEl.dataset.fileStatsSignature = signature;
        wrapEl.innerHTML = dpBuildFileStatsSectionsHtml(safeSections, { allowUndo });
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
        wrapEl.innerHTML = dpBuildFileStatsSectionsHtml(safeSections, { allowUndo });
        return;
      }

      safeSections.forEach((section) => {
        let sectionEl = sectionsRoot.querySelector(`.git-commit-file-section[data-scope="${dpCssEscape(section.kind)}"]`);
        if (!sectionEl) {
          sectionsRoot.insertAdjacentHTML("beforeend", dpBuildFileStatsSectionHtml(section, { allowUndo }));
          return;
        }
        const listEl = sectionEl.querySelector(".git-commit-file-list");
        if (!listEl) {
          sectionEl.outerHTML = dpBuildFileStatsSectionHtml(section, { allowUndo });
          return;
        }
        const desiredKeys = new Set(section.files.map((entry) => dpFileStatsRowKey(section.kind, entry)));
        listEl.querySelectorAll(".git-commit-file-row").forEach((row) => {
          const key = dpFileStatsRowKey(section.kind, { path: row.dataset.path || "" });
          if (!desiredKeys.has(key)) row.remove();
        });
        section.files.forEach((entry) => {
          const selector = `.git-commit-file-row[data-path="${dpCssEscape(String(entry?.path || "").trim())}"]`;
          const existing = listEl.querySelector(selector);
          if (!existing) {
            listEl.insertAdjacentHTML("beforeend", dpBuildFileRowHtml(entry, { allowUndo, scope: section.kind, animate: true }));
          } else {
            dpUpdateFileStatsRow(existing, entry);
          }
        });
      });
      wrapEl.dataset.fileStatsSignature = signature;
    };
    const dpRenderFileStatsInto = async (wrapEl, hash, { allowUndo = false, scope = "", incremental = false } = {}) => {
      if (!wrapEl) return null;
      if (!incremental) {
        wrapEl.innerHTML = '<div class="git-commit-file-empty inline-loading-row"></div>';
      }
      if (!hash && !scope) {
        const [stagedRes, unstagedRes, untrackedRes] = await Promise.all([
          fetchWithTimeout("/git-diff-files?scope=staged", {}, 5000),
          fetchWithTimeout("/git-diff-files?scope=unstaged", {}, 5000),
          fetchWithTimeout("/git-diff-files?scope=untracked", {}, 5000),
        ]);
        const stagedData = await stagedRes.json();
        const unstagedData = await unstagedRes.json();
        const untrackedData = await untrackedRes.json();
        const sections = [
          { title: "Staged", kind: "staged", files: Array.isArray(stagedData?.files) ? stagedData.files : [] },
          { title: "Unstaged", kind: "unstaged", files: Array.isArray(unstagedData?.files) ? unstagedData.files : [] },
          { title: "Untracked", kind: "untracked", files: Array.isArray(untrackedData?.files) ? untrackedData.files : [] },
        ].filter((section) => section.files.length);
        dpApplyFileStatsSectionsInto(wrapEl, sections, { allowUndo, incremental });
        return { files: sections.flatMap((section) => section.files || []) };
      }
      const params = new URLSearchParams({ hash: String(hash || "") });
      if (!hash && scope) params.set("scope", scope);
      const res = await fetchWithTimeout(`/git-diff-files?${params.toString()}`, {}, 5000);
      const data = await res.json();
      const files = Array.isArray(data?.files) ? data.files : [];
      if (!files.length) {
        wrapEl.innerHTML = '<div class="git-commit-file-empty">No changed files</div>';
        return data;
      }
      if (incremental && wrapEl.querySelector(".git-commit-file-list")) {
        const section = { title: "", kind: scope || "commit", files };
        dpApplyFileStatsSectionsInto(wrapEl, [section], { allowUndo, incremental });
      } else {
        wrapEl.innerHTML = `<div class="git-commit-file-list">${files.map((entry) => dpBuildFileRowHtml(entry, { allowUndo, scope })).join("")}</div>`;
      }
      return data;
    };
    const dpCloseGitDetail = ({ refreshList = false } = {}) => {
      if (!dpGitContent) return;
      const stack = dpGitContent.querySelector(".git-branch-stack");
      stack?.classList.remove("git-branch-transitioning", "git-branch-mode-detail", "git-branch-mode-worktree-detail");
      const body = dpGitContent.querySelector(".git-commit-detail-body");
      const head = dpGitContent.querySelector(".git-commit-detail-head");
      if (body) body.innerHTML = "";
      if (head) head.innerHTML = "";
      dpGitDetailContext = null;
      dpUpdateLoadMoreUi();
      dpEnsureGitObserver();
      const shouldRefresh = !!refreshList;
      dpGitDetailNeedsRefresh = false;
      if (shouldRefresh) void dpLoadGitBranchPage({ reset: true });
    };
    const dpLoadGitBranchPage = async ({ reset = false } = {}) => {
      if ((!dpPanelOpen && !dpGitSummaryPinned) || !dpGitContent) return;
      if (dpGitPageLoading) return;
      if (!reset && !dpGitHasMore && !dpGitLoadError) return;
      const loadSeq = ++dpGitLoadSeq;
      dpGitPageLoading = true;
      dpGitLoadError = "";
      dpDisconnectGitObserver();
      if (reset) {
        dpCloseGitDetail();
        dpGitHasMore = false;
        dpGitNextOffset = 0;
        dpGitTotalCommits = 0;
        dpGitCommits = [];
        dpGitContent.innerHTML = '<div class="dp-pane-title">Git</div><div class="dp-empty-state inline-loading-row"></div>';
      } else {
        dpUpdateLoadMoreUi();
      }
      try {
        const params = new URLSearchParams({ offset: String(reset ? 0 : dpGitNextOffset), limit: String(DP_GIT_BATCH) });
        if (reset) params.set("refresh", "1");
        const res = await fetchWithTimeout(`/git-branch-overview?${params.toString()}`, {}, 5000);
        if (!res.ok) throw new Error("Failed to load branch overview");
        const data = await res.json();
        if (loadSeq !== dpGitLoadSeq) return;
        dpApplyGitPage(data, { reset });
      } catch (err) {
        if (loadSeq !== dpGitLoadSeq) return;
        if (reset) {
          dpGitContent.innerHTML = `<div class="dp-pane-title">Git</div><div class="dp-empty-state">${escapeHtml(err?.message || "Load failed")}</div>`;
        } else {
          dpGitLoadError = err?.message || "Load failed";
        }
      } finally {
        if (loadSeq !== dpGitLoadSeq) return;
        dpGitPageLoading = false;
        dpUpdateLoadMoreUi();
        dpEnsureGitObserver();
      }
    };
    const dpOpenGitDetail = async ({ diffKind = "", hash = "", rowHtml = "", subject = "" } = {}) => {
      if (!dpGitContent) return;
      const stack = dpGitContent.querySelector(".git-branch-stack");
      if (!stack) return;
      const isWorktreeDetail = diffKind === "worktree";
      dpCloseGitDetail();
      dpDisconnectGitObserver();
      dpGitDetailNeedsRefresh = false;
      stack.classList.add("git-branch-transitioning");
      const headEl = dpGitContent.querySelector(".git-commit-detail-head");
      const bodyEl = dpGitContent.querySelector(".git-commit-detail-body");
      if (headEl) {
        headEl.title = subject;
        if (isWorktreeDetail) {
          headEl.innerHTML = "";
        } else {
          headEl.innerHTML = rowHtml;
        }
      }
      if (!bodyEl) return;
      const wrapEl = document.createElement("div");
      wrapEl.className = "git-commit-file-wrap";
      bodyEl.appendChild(wrapEl);
      stack.classList.add("git-branch-mode-detail");
      stack.classList.toggle("git-branch-mode-worktree-detail", isWorktreeDetail);
      dpGitDetailContext = {
        kind: diffKind === "worktree" || diffKind === "staged" || diffKind === "unstaged" ? diffKind : "commit",
        hash: diffKind === "worktree" || diffKind === "staged" || diffKind === "unstaged" ? "" : hash,
        wrapEl,
      };
      dpGitContent.scrollTop = 0;
      requestAnimationFrame(() => stack.classList.remove("git-branch-transitioning"));
      try {
        await dpRenderFileStatsInto(wrapEl, diffKind === "worktree" ? "" : hash, {
          allowUndo: diffKind === "worktree",
          scope: diffKind === "worktree" ? "" : diffKind,
        });
      } catch (_) {
        wrapEl.innerHTML = '<div class="git-commit-file-empty">Failed to load file stats</div>';
      }
    };
