__CHAT_INCLUDE:../../../shared/chat/git-panel-html.js__
__CHAT_INCLUDE:../../../shared/chat/git-panel-data.js__
__CHAT_INCLUDE:../../../shared/chat/git-panel-session.js__
    const gitSheetTitleEl = () => sharedSheetTitleEl;
    const setGitSheetTitle = () => {
      const titleEl = gitSheetTitleEl();
      if (!titleEl) return;
      titleEl.classList.remove("git-sheet-detail-title");
      titleEl.textContent = "Git";
      titleEl.title = "Git";
    };
    const gitWorktreeSummaryBtn = () => gitPanel?.querySelector(".git-worktree-summary");
    const showGitWorktreeSummary = () => {
      const btn = gitWorktreeSummaryBtn();
      if (btn) btn.hidden = !!gitSession.detailContext;
    };
    const hideGitWorktreeSummary = () => {
      const btn = gitWorktreeSummaryBtn();
      if (btn) btn.hidden = true;
    };
    const animateGitSheetList = (selector, transition) => {
      const list = gitPanel?.querySelector(selector);
      if (!list) return;
      delete list.dataset.transition;
      void list.offsetWidth;
      list.dataset.transition = transition;
    };
    const renderGitWorktreeSummary = (data) => {
      let btn = gitWorktreeSummaryBtn();
      if (!btn) {
        const sheetPanel = gitPanel?.querySelector(".git-sheet-panel");
        if (!sheetPanel) return;
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "git-worktree-summary git-summary-row mobile-bottom-sheet-button";
        sheetPanel.appendChild(btn);
      }
      const changedPaths = Math.max(0, parseInt(data?.worktree_changed_paths) || 0);
      const added = Math.max(0, parseInt(data?.worktree_added) || 0);
      const deleted = Math.max(0, parseInt(data?.worktree_deleted) || 0);
      const hasDiff = !!data?.worktree_has_diff;
      btn.disabled = !hasDiff;
      btn.classList.toggle("clickable", hasDiff);
      if (hasDiff) btn.dataset.diffKind = "worktree";
      else delete btn.dataset.diffKind;
      btn.setAttribute("aria-label", hasDiff ? "Open uncommitted changes" : "Working tree clean");
      btn.innerHTML = `<span class="git-summary-meta-text">${gitPathCountText(changedPaths)}</span>${gitCountsHtml(added, deleted)}`;
      showGitWorktreeSummary();
    };
    const setGitDetailChrome = ({ rowHtml = "", subject = "Git" } = {}) => {
      const titleEl = gitSheetTitleEl();
      if (titleEl) {
        const subjectEl = document.createElement("span");
        subjectEl.className = "git-sheet-detail-subject";
        subjectEl.textContent = subject;
        const template = document.createElement("template");
        template.innerHTML = rowHtml.trim();
        const countsEl = template.content.querySelector(".git-summary-counts");
        titleEl.classList.add("git-sheet-detail-title");
        titleEl.replaceChildren(subjectEl);
        if (countsEl) titleEl.appendChild(countsEl.cloneNode(true));
        titleEl.title = subject;
      }
      hideGitWorktreeSummary();
      setSharedSheetLeading(
        () => gitSession.closeDetail({ refreshList: gitSession.detailNeedsRefresh }),
        "Back to commits",
        mobileSheetBackIcon,
      );
      animateGitSheetList(".git-detail-view", "forward");
    };
    const resetGitDetailChrome = ({ hadDetail = false } = {}) => {
      setGitSheetTitle();
      setSharedSheetLeading(null);
      showGitWorktreeSummary();
      if (hadDetail) animateGitSheetList(".git-list-view", "back");
    };
    const setGitPanelBodyHtml = (html) => {
      const contentEl = ensureGitSheetDom();
      if (contentEl) {
        contentEl.innerHTML = html;
        return;
      }
      if (gitPanel) gitPanel.innerHTML = html;
    };
    const gitSheetListEl = () => gitPanel?.querySelector(
      gitSession.detailContext ? ".git-detail-view .mobile-sheet-list" : ".git-list-view .mobile-sheet-list"
    ) || gitPanel;
    const gitSession = createGitPanelSession({
      root: () => gitPanel,
      modeEl: () => gitPanel?.querySelector(".git-stack") || gitPanel,
      observerRoot: gitSheetListEl,
      scrollRoot: gitSheetListEl,
      canLoad: () => !!gitPanel,
      canRefresh: () => !!gitPanel,
      renderShell: (data) => {
        renderGitWorktreeSummary(data);
        setGitPanelBodyHtml(`
        <div class="git-stack mobile-sheet-stack mobile-sheet-stage">
          <div class="git-list-view mobile-sheet-view mobile-sheet-list">
            <div class="git-commit-list"></div>
            <button type="button" class="page-menu-item git-load-more" hidden></button>
          </div>
          <div class="git-detail-view mobile-sheet-view mobile-sheet-list">
            <div class="git-commit-detail-body"></div>
          </div>
        </div>`);
      },
      setBodyHtml: setGitPanelBodyHtml,
      loadingHtml: `<div class="mobile-sheet-list"><div class="git-commit-file-empty sheet-list-empty inline-loading-row">${loadingIndicatorHtml()}</div></div>`,
      errorHtml: (message) => `<div class="mobile-sheet-list"><div class="git-commit-file-empty sheet-list-empty error">${escapeHtml(message)}</div></div>`,
      emptyCommitsHtml: '<div class="git-commit-file-empty sheet-list-empty" data-git-empty="1">No commits</div>',
      loadMoreLoadingHtml: loadingIndicatorHtml(),
      loadMoreRetryText: "Retry loading commits",
      loadMoreCountText: (loaded, total) => `Load more commits (${loaded}/${total})`,
      onLoadReset: () => {
        setGitSheetTitle();
        hideGitWorktreeSummary();
      },
      onCloseDetail: resetGitDetailChrome,
      onOpenDetail: setGitDetailChrome,
      onFingerprintChanged: (data) => {
        const previous = gitCountSnapshot(gitWorktreeSummaryBtn());
        renderGitWorktreeSummary(data || {});
        animateGitCountsFromSnapshot(gitWorktreeSummaryBtn(), previous);
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
      void gitSession.handleClick(event);
    });
