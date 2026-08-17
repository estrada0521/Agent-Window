    const DP_GIT_SUMMARY_PIN_SVG = '📌';
    const dpBuildSummaryHtml = (data) => {
      const pinBtn = `<button type="button" class="git-summary-pin" aria-pressed="false" aria-label="未コミット概要をチャット右端に固定表示" title="右ペインを閉じても右端にこの概要を表示">${DP_GIT_SUMMARY_PIN_SVG}</button>`;
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
    const dpDisconnectGitObserver = () => {
      if (!dpGitObserver) return;
      try { dpGitObserver.disconnect(); } catch (_) {}
      dpGitObserver = null;
    };
    const dpGitCommitListEl = () => dpGitContent?.querySelector(".git-commit-list");
    const dpGitLoadMoreEl = () => dpGitContent?.querySelector(".git-load-more");
    const dpRenderCommitRows = (commits, { append = false, newHashes = null } = {}) => {
      const listEl = dpGitCommitListEl();
      if (!listEl) return;
      if (!append) {
        if (!commits.length) {
          listEl.innerHTML = '<div class="dp-empty-state" data-git-empty="1">No commits</div>';
          return;
        }
        listEl.innerHTML = commits.map(c => {
          const isNew = newHashes && newHashes.has(c.hash);
          return gitCommitRowHtml(c, { animate: isNew });
        }).join("");
        return;
      }
      if (!commits.length) return;
      listEl.querySelector("[data-git-empty]")?.remove();
      listEl.insertAdjacentHTML("beforeend", commits.map(c => gitCommitRowHtml(c)).join(""));
    };
    const dpUpdateLoadMoreUi = () => {
      const btn = dpGitLoadMoreEl();
      if (!btn) return;
      if (!dpGitHasMore && !dpGitLoadError) {
        btn.hidden = true;
        btn.disabled = true;
        btn.textContent = "";
        return;
      }
      btn.hidden = false;
      btn.disabled = dpGitPageLoading;
      if (dpGitLoadError) {
        btn.innerHTML = "Retry loading commits";
      } else if (dpGitPageLoading) {
        btn.textContent = "";
      } else if (dpGitTotalCommits > 0) {
        btn.textContent = `Load more (${dpGitCommits.length}/${dpGitTotalCommits})`;
      } else {
        btn.textContent = "Load more commits";
      }
    };
    const dpEnsureGitObserver = () => {
      dpDisconnectGitObserver();
      const btn = dpGitLoadMoreEl();
      if (!btn || !dpGitHasMore || dpGitPageLoading || dpGitLoadError || typeof IntersectionObserver !== "function") return;
      dpGitObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) void dpLoadGitPage();
        });
      }, { root: dpGitContent?.querySelector(".git-commit-scroll") ?? dpGitContent, rootMargin: "220px 0px", threshold: 0.01 });
      dpGitObserver.observe(btn);
    };
    const dpRenderGitShell = (data) => {
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
