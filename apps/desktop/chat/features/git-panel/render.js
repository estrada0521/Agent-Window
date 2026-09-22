    const DP_GIT_SUMMARY_PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="6"/><path d="M12 14v8"/></svg>';
    const dpBuildSummaryHtml = (data) => {
      const pinBtn = `<button type="button" class="git-summary-pin" aria-pressed="false" aria-label="Pin Git Summary" title="Pin to Chat [⇧⌘P]">${DP_GIT_SUMMARY_PIN_SVG}</button>`;
      return gitSummaryRowHtml(data, { leadingHtml: pinBtn });
    };
    const dpBuildSummaryState = (data) => {
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
        rowHtml: dpBuildSummaryHtml(data),
      };
    };
    const dpRenderGitShell = () => {
      if (!dpGitContent) return;
      dpGitContent.innerHTML = `
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
    const dpSyncSummaryWrap = () => {
      dpApplyGitOverviewHeader();
    };
