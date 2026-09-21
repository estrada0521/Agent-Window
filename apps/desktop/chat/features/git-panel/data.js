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
      if (!hasDesktopRightPanelOverlay() || !dpPinnedStripActive()) return;
      const data = await fetchGitOverview({ offset: 0, refresh: true, summary: true });
      dpGitHeaderSummaryState = dpBuildSummaryState(data);
      dpApplyGitOverviewHeader();
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
    const dpPostOpenFile = async (rawPath) => {
      const normalizedPath = normalizeWorkspaceFilePath(rawPath);
      if (!normalizedPath) return;
      const errMsg = "Failed to open file in the default app.";
      try {
        await postOpenFile(normalizedPath);
        setStatus(`Opened ${normalizedPath}`);
        setTimeout(() => setStatus(""), STATUS_TOAST_MS);
      } catch (err) {
        setStatus(err?.message || errMsg, true);
        setTimeout(() => setStatus(""), STATUS_TOAST_MS);
      }
    };
    const dpPostOpenDiff = async (rawPath, hash = "") => {
      const normalizedPath = normalizeWorkspaceFilePath(rawPath);
      if (!normalizedPath) return;
      const errMsg = "Failed to open diff tool.";
      try {
        await postOpenDiff(normalizedPath, hash);
        setStatus(`Opened diff for ${normalizedPath}`);
        setTimeout(() => setStatus(""), STATUS_TOAST_MS);
      } catch (err) {
        setStatus(err?.message || errMsg, true);
        setTimeout(() => setStatus(""), STATUS_TOAST_MS);
      }
    };
    const gitSession = createGitPanelSession({
      root: () => dpGitContent,
      modeEl: () => dpGitContent?.querySelector(".git-stack") || dpGitContent,
      observerRoot: () => dpGitContent?.querySelector(".git-commit-scroll") ?? dpGitContent,
      scrollRoot: () => dpGitContent,
      canLoad: () => (dpPanelOpen || dpPinnedStripActive()) && !!dpGitContent,
      canRefresh: () => dpPanelOpen || dpPinnedStripActive(),
      renderShell: () => dpRenderGitShell(),
      setBodyHtml: (html) => {
        if (dpGitContent) dpGitContent.innerHTML = html;
      },
      loadingHtml: '<div class="dp-empty-state inline-loading-row"></div>',
      errorHtml: (message) => `<div class="dp-empty-state error">${escapeHtml(message)}</div>`,
      emptyCommitsHtml: '<div class="dp-empty-state" data-git-empty="1">No commits</div>',
      loadMoreRetryText: "Retry loading commits",
      loadMoreCountText: (loaded, total) => `Load more (${loaded}/${total})`,
      worktreeDetailClass: true,
      detailHeadHtml: ({ isWorktree, rowHtml }) => (isWorktree ? "" : rowHtml),
      commitRowOptions: (commit, newHashes) => ({ animate: !!(newHashes && newHashes.has(commit.hash)) }),
      onOverview: (data) => {
        dpGitHeaderSummaryState = dpBuildSummaryState(data || {});
        dpApplyGitOverviewHeader();
      },
      onPage: (data) => {
        dpGitHeaderSummaryState = dpBuildSummaryState(data || {});
        dpSyncSummaryWrap();
      },
      onFingerprintChanged: (data, { isFirst, previousCommits, detailContext }) => {
        if (!dpPanelOpen && dpPinnedStripActive()) {
          return { updateList: false };
        }
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
      await gitSession.refresh();
    };
