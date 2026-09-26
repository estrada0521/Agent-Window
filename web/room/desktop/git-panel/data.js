    const dpToggleGitSummaryPinned = () => {
      dpGitSummaryPinned = !dpGitSummaryPinned;
      localStorage.setItem(dpGitSummaryPinnedStorageKey(), dpGitSummaryPinned ? "1" : "0");
      if (dpGitSummaryPinned) {
        if (!dpGitHeaderSummaryState?.rowHtml) void dpBootstrapPinnedGitSummary();
        else dpSyncPinnedSummaryStrip();
      } else {
        dpSyncPinnedSummaryStrip();
      }
    };
    const dpBootstrapPinnedGitSummary = async () => {
      if (!dpPinnedStripActive()) return;
      const data = await fetchGitOverview({ offset: 0, refresh: true, summary: true });
      dpGitHeaderSummaryState = dpBuildSummaryState(data);
      dpApplyGitOverviewHeader();
    };
    const dpOnTimelineSummaryPinReload = ({ force = false } = {}) => {
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
      const errMsg = "Open failed";
      try {
        await postOpenFile(normalizedPath);
      } catch (err) {
        setStatus(err?.message || errMsg);
      }
    };
    const dpPostOpenDiff = async (rawPath, hash = "", oldPath = "") => {
      const normalizedPath = normalizeWorkspaceFilePath(rawPath);
      if (!normalizedPath) return;
      const errMsg = "Diff failed";
      try {
        await postOpenDiff(normalizedPath, hash, oldPath);
      } catch (err) {
        setStatus(err?.message || errMsg);
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
      detailHeadHtml: ({ isWorktree, rowHtml }) => {
        if (isWorktree) return "";
        const temp = document.createElement("div");
        temp.innerHTML = rowHtml;
        temp.querySelector(".git-commit-paths")?.remove();
        return temp.innerHTML;
      },
      commitRowOptions: (commit, newHashes) => ({ animate: !!(newHashes && newHashes.has(commit.hash)) }),
      onOverview: (data) => {
        dpGitHeaderSummaryState = dpBuildSummaryState(data || {});
        dpApplyGitOverviewHeader();
      },
      onPage: (data) => {
        dpGitHeaderSummaryState = dpBuildSummaryState(data || {});
        dpSyncSummaryWrap();
      },
    });
    const dpLoadGitPage = (opts) => gitSession.loadPage(opts);
    const dpOpenGitDetail = (opts) => gitSession.openDetail(opts);
    const dpCloseGitDetail = (opts) => gitSession.closeDetail(opts);
    const dpDisconnectGitObserver = () => gitSession.disconnectObserver();
    const dpRefreshGitOverview = async () => {
      await gitSession.refresh();
    };
