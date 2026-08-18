__CHAT_INCLUDE:../../../shared/chat/git-panel-html.js__
__CHAT_INCLUDE:../../../shared/chat/git-panel-data.js__
__CHAT_INCLUDE:../../../shared/chat/git-panel-session.js__
    const gitSheetTitleEl = () => gitPanel?.querySelector(".git-sheet-title");
    const setGitSheetTitle = () => {
      const titleEl = gitSheetTitleEl();
      if (!titleEl) return;
      titleEl.textContent = "Git";
      titleEl.title = "Git";
    };
    const setGitPanelBodyHtml = (html) => {
      const contentEl = ensureGitSheetDom();
      if (contentEl) {
        contentEl.innerHTML = html;
        return;
      }
      if (gitPanel) gitPanel.innerHTML = html;
    };
    const gitSession = createGitPanelSession({
      root: () => gitPanel,
      modeEl: () => gitPanel?.querySelector(".git-stack") || gitPanel,
      observerRoot: () => gitPanel?.querySelector(".git-sheet-content") || gitPanel,
      scrollRoot: () => gitPanel?.querySelector(".git-sheet-content") || gitPanel,
      canLoad: () => !!gitPanel,
      canRefresh: () => !!gitPanel,
      worktreeDetailClass: true,
      detailHeadHtml: ({ isWorktree, rowHtml }) => (isWorktree ? "" : rowHtml),
      renderShell: (data) => {
        setGitPanelBodyHtml(`
        <div class="git-stack">
          <div class="git-list-view">
            <div class="git-summary-wrap">${gitSummaryRowHtml(data)}</div>
            <div class="git-commit-list"></div>
            <button type="button" class="page-menu-item git-load-more" hidden></button>
          </div>
          <div class="git-detail-view">
            <button type="button" class="git-commit-detail-head" aria-label="コミット一覧に戻る"></button>
            <div class="git-commit-detail-body"></div>
          </div>
        </div>`);
      },
      setBodyHtml: setGitPanelBodyHtml,
      loadingHtml: `<div class="git-commit-file-empty inline-loading-row">${loadingIndicatorHtml()}</div>`,
      errorHtml: (message) => `<div class="git-commit-file-empty error">${escapeHtml(message)}</div>`,
      emptyCommitsHtml: '<div class="git-commit-file-empty" data-git-empty="1">No commits</div>',
      loadMoreLoadingHtml: loadingIndicatorHtml(),
      loadMoreRetryText: "Retry loading commits",
      loadMoreCountText: (loaded, total) => `Load more commits (${loaded}/${total})`,
      onLoadReset: () => setGitSheetTitle(),
      onCloseDetail: () => setGitSheetTitle(),
      onOpenDetail: () => setGitSheetTitle(),
      onFingerprintChanged: (data) => {
        const summaryWrap = gitPanel.querySelector(".git-summary-wrap");
        if (summaryWrap) {
          const previous = gitCountSnapshot(summaryWrap);
          summaryWrap.innerHTML = gitSummaryRowHtml(data || {});
          animateGitCountsFromSnapshot(summaryWrap, previous);
        }
        return { updateList: true };
      },
    });
    const updateGitPanel = async () => {
      if (!gitPanel) return;
      if (gitSession.hasShell()) {
        try {
          await gitSession.refresh();
        } catch (_) { }
        return;
      }
      await gitSession.loadPage({ reset: true });
    };
    gitPanel?.addEventListener("click", (event) => {
      void gitSession.handleClick(event, { closeWorktreeSummaryClick: true });
    });
