    const toggleGitSummaryPinned = () => {
      gitSummaryPinned = !gitSummaryPinned;
      localStorage.setItem(gitSummaryPinnedStorageKey(), gitSummaryPinned ? "1" : "0");
      if (gitSummaryPinned) {
        if (!gitHeaderSummaryState?.rowHtml) void bootstrapPinnedGitSummary();
        else syncPinnedSummaryStrip();
      } else {
        syncPinnedSummaryStrip();
      }
    };
    const bootstrapPinnedGitSummary = async () => {
      if (!gitSummaryPinned) return;
      const tree = gitTree();
      const data = await fetchGitOverview({ offset: 0, summary: true });
      if (tree !== gitTree() || !gitSummaryPinned) return;
      gitHeaderSummaryState = buildSummaryState(data);
      applyGitOverviewHeader();
    };
    let unpinnedGitSummaryRequest = 0;
    let unpinnedGitSummaryShown = "";
    const unpinnedGitSummaryHud = document.createElement("div");
    unpinnedGitSummaryHud.className = "git-commit-meta";
    const notifyUnpinnedGitSummary = async () => {
      const request = ++unpinnedGitSummaryRequest;
      const timeline = currentTimelineName;
      const tree = gitTree();
      const relevant = () => request === unpinnedGitSummaryRequest &&
        timeline === currentTimelineName && tree === gitTree() && !gitSummaryPinned && !sideBarOpen;
      try {
        const data = await fetchGitOverview({ summary: true });
        if (!relevant()) return;
        const row = document.createElement("div");
        row.innerHTML = gitSummaryRowHtml(data);
        const summary = row.querySelector(".git-commit-meta");
        if (!summary) throw new Error("Git summary unavailable");
        const previous = gitCountSnapshot(unpinnedGitSummaryHud);
        unpinnedGitSummaryHud.replaceChildren(...summary.childNodes);
        animateGitCountsFromSnapshot(unpinnedGitSummaryHud, previous);
        gitHeaderSummaryState = buildSummaryState(data);
        applyGitOverviewHeader();
        const shown = `${timeline}\n${tree}\n${gitWorktreeCountsKey(data)}`;
        if (shown === unpinnedGitSummaryShown) return;
        unpinnedGitSummaryShown = shown;
        setStatus(unpinnedGitSummaryHud);
      } catch (err) {
        if (relevant()) setError("Git unavailable", err);
      }
    };
    const onTimelineSummaryPinReload = ({ force = false } = {}) => {
      const storageKey = gitSummaryPinnedStorageKey();
      if (!force && _gitSummaryPinnedLoadedForKey === storageKey) return;
      _gitSummaryPinnedLoadedForKey = storageKey;
      readGitSummaryPinnedFromStorage();
      gitPanel.invalidateFingerprint();
      if (gitSummaryPinned) {
        void bootstrapPinnedGitSummary();
      }
      syncPinnedSummaryStrip();
      applySideBarWidth();
    };
    const gitPanel = createGitPanelController({
      root: () => gitContent,
      modeEl: () => gitContent?.querySelector(".git-stack") || gitContent,
      observerRoot: () => gitContent?.querySelector(".git-commit-scroll") ?? gitContent,
      scrollRoot: () => gitContent,
      canLoad: () => (sideBarOpen || gitSummaryPinned) && !!gitContent,
      canRefresh: () => sideBarOpen || gitSummaryPinned,
      renderShell: () => renderGitShell(),
      setBodyHtml: (html) => {
        if (gitContent) gitContent.innerHTML = html;
      },
      loadingHtml: '<div class="empty-state inline-loading-row"></div>',
      errorHtml: (message) => `<div class="empty-state error">${escapeHtml(message)}</div>`,
      emptyCommitsHtml: '<div class="empty-state" data-git-empty="1">No commits</div>',
      loadMoreRetryText: "Retry loading commits",
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
        gitHeaderSummaryState = buildSummaryState(data || {});
        applyGitOverviewHeader();
      },
      onPage: (data) => {
        gitHeaderSummaryState = buildSummaryState(data || {});
        syncSummaryWrap();
      },
    });
    const loadGitPage = (opts) => gitPanel.loadPage(opts);
    const openGitDetail = (opts) => gitPanel.openDetail(opts);
    const closeGitDetail = (opts) => gitPanel.closeDetail(opts);
    const disconnectGitObserver = () => gitPanel.disconnectObserver();
    const refreshGitOverview = async () => {
      await gitPanel.refresh();
    };
