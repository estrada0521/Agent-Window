    const buildSummaryHtml = (data) => {
      const pinBtn = `<button type="button" class="git-summary-pin" aria-pressed="false" aria-label="Pin changes" title="Pin changes [⇧⌘P]">${GIT_SUMMARY_PIN_SVG}</button>`;
      return gitSummaryRowHtml(data, { leadingHtml: pinBtn });
    };
    const buildSummaryState = (data) => {
      const changedPaths = Math.max(0, parseInt(data?.worktree_changed_paths) || 0);
      const worktreeAdded = Math.max(0, parseInt(data?.worktree_added) || 0);
      const worktreeDeleted = Math.max(0, parseInt(data?.worktree_deleted) || 0);
      const summaryBits = changedPaths
        ? ["Uncommitted changes", gitPathCountText(changedPaths), `+${worktreeAdded}`, `-${worktreeDeleted}`]
        : ["Working tree clean"];
      return {
        text: summaryBits.join(" · "),
        subject: changedPaths ? "Uncommitted changes" : "Working tree clean",
        clickable: !!data?.worktree_has_diff,
        counts: [worktreeAdded, worktreeDeleted],
        rowHtml: buildSummaryHtml(data),
      };
    };
    const renderGitShell = () => {
      if (!gitContent) return;
      gitContent.innerHTML = `
        <div class="git-stack">
          <div class="git-list-view">
            <div class="git-summary-wrap"></div>
            <div class="git-commit-scroll">
              <div class="git-commit-list"></div>
              <button type="button" class="git-load-more" hidden></button>
            </div>
          </div>
          <div class="git-detail-view">
            <button type="button" class="git-commit-detail-head" aria-label="Back"></button>
            <div class="git-commit-detail-body"></div>
          </div>
        </div>`;
    };
    const syncSummaryWrap = () => {
      applyGitOverviewHeader();
    };
