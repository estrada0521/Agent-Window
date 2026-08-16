    const dpGitSummaryPinnedStorageKey = () => `agent_window_git_summary_pinned:${String(currentSessionName || "").trim() || "__none"}`;
    let dpGitSummaryPinned = true;
    let _dpGitSummaryPinnedLoadedForKey = "";
    const dpReadGitSummaryPinnedFromStorage = () => {
      try {
        const stored = window.localStorage?.getItem(dpGitSummaryPinnedStorageKey());
        dpGitSummaryPinned = stored === null ? true : stored === "1";
      } catch (_) {
        dpGitSummaryPinned = true;
      }
    };
    const dpApplySummaryPinButtonPressed = (root) => {
      if (!root) return;
      root.querySelectorAll(".git-branch-summary-pin").forEach((btn) => {
        btn.setAttribute("aria-pressed", dpGitSummaryPinned ? "true" : "false");
        btn.classList.toggle("is-pinned", dpGitSummaryPinned);
        btn.title = dpGitSummaryPinned ? "ピンを外して右端の表示を消す" : "右ペインを閉じても右端にこの概要を表示";
      });
    };
    const dpGitCountSnapshot = gitBranchCountSnapshot;
    const dpAnimateGitCount = animateGitBranchCount;
    const dpAnimateGitCountsFromSnapshot = animateGitBranchCountsFromSnapshot;
    const dpRenderGitSummaryRoot = (root, rowHtml) => {
      if (!root) return;
      const existingRow = root.querySelector(".git-branch-summary-row");
      if (existingRow && rowHtml) {
        const temp = document.createElement("div");
        temp.innerHTML = rowHtml;
        const nextRow = temp.querySelector(".git-branch-summary-row");
        if (nextRow) {
          existingRow.className = nextRow.className;
          if (nextRow.dataset.diffKind) existingRow.dataset.diffKind = nextRow.dataset.diffKind;
          else delete existingRow.dataset.diffKind;
          const existingMeta = existingRow.querySelector(".git-branch-summary-meta-text");
          const nextMeta = nextRow.querySelector(".git-branch-summary-meta-text");
          if (existingMeta && nextMeta && existingMeta.textContent !== nextMeta.textContent) {
            existingMeta.textContent = nextMeta.textContent;
          }
          const existingCounts = Array.from(existingRow.querySelectorAll(".git-branch-summary-count"));
          const nextCounts = Array.from(nextRow.querySelectorAll(".git-branch-summary-count"));
          existingCounts.forEach((countEl, idx) => {
            const nextCount = nextCounts[idx];
            if (!nextCount) return;
            const nextValue = Math.max(0, parseInt(nextCount.dataset.countValue || nextCount.textContent || "0") || 0);
            const prevValue = Math.max(0, parseInt(countEl.dataset.countValue || countEl.textContent || "0") || 0);
            countEl.dataset.countValue = String(nextValue);
            dpAnimateGitCount(countEl, prevValue, nextValue);
          });
          const existingChevron = existingRow.querySelector(".git-commit-chevron");
          const nextChevron = nextRow.querySelector(".git-commit-chevron");
          if (existingChevron && !nextChevron) existingChevron.remove();
          else if (!existingChevron && nextChevron) existingRow.appendChild(nextChevron.cloneNode(true));
          dpApplySummaryPinButtonPressed(root);
          return;
        }
      }
      const previous = dpGitCountSnapshot(root);
      root.innerHTML = rowHtml;
      dpApplySummaryPinButtonPressed(root);
      dpAnimateGitCountsFromSnapshot(root, previous);
    };
    const dpSummaryCountsKey = (state) =>
      Array.isArray(state?.counts) ? state.counts.map((value) => Math.max(0, parseInt(value) || 0)).join(":") : "";
    let dpGitCommits = [];
    let dpGitNextOffset = 0;
    let dpGitTotalCommits = 0;
    let dpGitHasMore = false;
    let dpGitPageLoading = false;
    let dpGitLoadError = "";
    let dpGitLoadSeq = 0;
    let dpGitDetailContext = null;
    let dpGitDetailNeedsRefresh = false;
    let dpGitObserver = null;
    let dpGitHeaderSummaryState = null;
    let dpGitAppliedSummaryCountsKey = "";
    const dpApplyGitOverviewHeader = () => {
      const rowHtml = dpGitHeaderSummaryState?.rowHtml || "";
      const countsKey = dpSummaryCountsKey(dpGitHeaderSummaryState);
      const shouldAnimate = countsKey !== dpGitAppliedSummaryCountsKey;
      const panelWrap = dpGitContent?.querySelector(".git-branch-summary-wrap");
      const aside = document.getElementById("gitPinnedSummaryAside");
      const inner = document.getElementById("gitPinnedSummaryInner");
      const overlay = hasDesktopRightPanelOverlay();
      const stripShown = !!dpGitSummaryPinned && !dpPanelOpen;

      if (overlay && aside && inner) {
        aside.hidden = !stripShown;
      }

      if (stripShown && inner && overlay) {
        if (shouldAnimate) dpRenderGitSummaryRoot(inner, rowHtml);
        else {
          inner.innerHTML = rowHtml;
          dpApplySummaryPinButtonPressed(inner);
        }
      } else if (dpPanelOpen && panelWrap) {
        if (shouldAnimate) dpRenderGitSummaryRoot(panelWrap, rowHtml);
        else {
          panelWrap.innerHTML = rowHtml;
          dpApplySummaryPinButtonPressed(panelWrap);
        }
      } else if (panelWrap) {
        if (shouldAnimate) dpRenderGitSummaryRoot(panelWrap, rowHtml);
        else {
          panelWrap.innerHTML = rowHtml;
          dpApplySummaryPinButtonPressed(panelWrap);
        }
      }
      dpGitAppliedSummaryCountsKey = countsKey;

      if (overlay && aside && inner) dpApplyPanelWidth();
    };
    const dpSyncPinnedSummaryStrip = () => {
      dpApplyGitOverviewHeader();
    };
