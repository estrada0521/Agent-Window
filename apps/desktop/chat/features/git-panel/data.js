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
        const data = await fetchGitOverview({ offset: 0 });
        dpGitHeaderSummaryState = dpBuildSummaryState(data);
        dpApplyGitOverviewHeader();
        gitSession.setFingerprint(gitOverviewFingerprint(data));
      } catch (_) {}
    };
    const dpOnSessionSummaryPinReload = ({ force = false } = {}) => {
      const storageKey = dpGitSummaryPinnedStorageKey();
      if (!force && _dpGitSummaryPinnedLoadedForKey === storageKey) return;
      _dpGitSummaryPinnedLoadedForKey = storageKey;
      dpReadGitSummaryPinnedFromStorage();
      gitSession.invalidateFingerprint();
      if (dpGitSummaryPinned) {
        void dpBootstrapPinnedGitSummary();
      }
      dpSyncPinnedSummaryStrip();
      dpApplyPanelWidth();
    };
    const dpPostOpenFileInEditor = async (rawPath, line = 0) => {
      const normalizedPath = normalizeWorkspaceFilePath(rawPath);
      if (!normalizedPath) return;
      const normalizedLine = Number.isFinite(line) && line > 0 ? Math.floor(line) : 0;
      const payload = { path: normalizedPath, line: normalizedLine };
      const tryPost = () => fetch("/open-file-in-editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const okMsg = `Opened ${normalizedPath}`;
      const errMsg = "Failed to open file in the default app.";
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
    const dpCssEscape = (value) => {
      if (window.CSS?.escape) return CSS.escape(String(value || ""));
      return String(value || "").replace(/["\\]/g, "\\$&");
    };
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
    const dpApplyFileStatsSectionsInto = (wrapEl, sections, { allowUndo = false, incremental = false } = {}) => {
      const safeSections = (sections || []).filter((section) => Array.isArray(section.files) && section.files.length);
      const signature = gitFileStatsRowsSignature(safeSections);
      if (!safeSections.length) {
        wrapEl.dataset.fileStatsSignature = "";
        wrapEl.innerHTML = '<div class="git-commit-file-empty">No changed files</div>';
        return;
      }
      if (!incremental || !wrapEl.querySelector(".git-commit-file-sections")) {
        wrapEl.dataset.fileStatsSignature = signature;
        wrapEl.innerHTML = gitCommitFileStatsSectionsHtml(safeSections, { allowUndo });
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
        return;
      }

      safeSections.forEach((section) => {
        let sectionEl = sectionsRoot.querySelector(`.git-commit-file-section[data-scope="${dpCssEscape(section.kind)}"]`);
        if (!sectionEl) {
          sectionsRoot.insertAdjacentHTML("beforeend", gitCommitFileStatsSectionHtml(section, { allowUndo }));
          return;
        }
        const listEl = sectionEl.querySelector(".git-commit-file-list");
        if (!listEl) {
          sectionEl.outerHTML = gitCommitFileStatsSectionHtml(section, { allowUndo });
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
            listEl.insertAdjacentHTML("beforeend", gitCommitFileRowHtml(entry, { allowUndo, scope: section.kind, animate: true }));
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
      const loaded = await loadGitDiffFileStats({ hash, scope });
      if (loaded.mode === "sections") {
        dpApplyFileStatsSectionsInto(wrapEl, loaded.sections, { allowUndo, incremental });
        return { files: loaded.files };
      }
      const files = loaded.files;
      if (!files.length) {
        wrapEl.innerHTML = '<div class="git-commit-file-empty">No changed files</div>';
        return loaded.data;
      }
      if (incremental && wrapEl.querySelector(".git-commit-file-list")) {
        dpApplyFileStatsSectionsInto(wrapEl, [{ title: "", kind: scope || "commit", files }], { allowUndo, incremental });
      } else {
        wrapEl.innerHTML = gitCommitFileListHtml(files, { allowUndo, scope });
      }
      return loaded.data;
    };
    const gitSession = createGitPanelSession({
      root: () => dpGitContent,
      modeEl: () => dpGitContent?.querySelector(".git-stack") || dpGitContent,
      observerRoot: () => dpGitContent?.querySelector(".git-commit-scroll") ?? dpGitContent,
      scrollRoot: () => dpGitContent,
      canLoad: () => (dpPanelOpen || dpGitSummaryPinned) && !!dpGitContent,
      canRefresh: () => dpPanelOpen || dpGitSummaryPinned,
      renderShell: () => dpRenderGitShell(),
      setBodyHtml: (html) => {
        if (dpGitContent) dpGitContent.innerHTML = html;
      },
      loadingHtml: '<div class="dp-empty-state inline-loading-row"></div>',
      errorHtml: (message) => `<div class="dp-empty-state">${escapeHtml(message)}</div>`,
      emptyCommitsHtml: '<div class="dp-empty-state" data-git-empty="1">No commits</div>',
      loadMoreRetryText: "Retry loading commits",
      loadMoreCountText: (loaded, total) => `Load more (${loaded}/${total})`,
      worktreeDetailClass: true,
      detailHeadHtml: ({ isWorktree, rowHtml }) => (isWorktree ? "" : rowHtml),
      commitRowOptions: (commit, newHashes) => ({ animate: !!(newHashes && newHashes.has(commit.hash)) }),
      renderFileStatsInto: dpRenderFileStatsInto,
      onPage: (data) => {
        dpGitHeaderSummaryState = dpBuildSummaryState(data || {});
        dpSyncSummaryWrap();
      },
      onFingerprintChanged: (data, { isFirst, previousCommits, detailContext }) => {
        if (!dpPanelOpen && dpGitSummaryPinned) {
          dpGitHeaderSummaryState = dpBuildSummaryState(data);
          dpApplyGitOverviewHeader();
          return { updateList: false };
        }
        dpGitHeaderSummaryState = dpBuildSummaryState(data);
        dpSyncSummaryWrap();
        if (detailContext) return { updateList: false };
        return {
          updateList: true,
          newHashes: isFirst ? null : gitNewCommitHashes(previousCommits, data?.recent_commits),
        };
      },
    });
    const dpLoadGitPage = (opts) => gitSession.loadPage(opts);
    const dpOpenGitDetail = (opts) => gitSession.openDetail(opts);
    const dpCloseGitDetail = (opts) => gitSession.closeDetail(opts);
    const dpDisconnectGitObserver = () => gitSession.disconnectObserver();
    const dpRefreshGitOverview = async () => {
      try {
        await gitSession.refresh();
      } catch (_) {}
    };
