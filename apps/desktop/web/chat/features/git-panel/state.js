    const DP_GIT_BATCH = 50;
    const dpGitSummaryPinnedStorageKey = () => `multiagent_git_summary_pinned:${String(currentSessionName || "").trim() || "__none"}`;
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
    const dpShouldAnimateGitCounts = () =>
      !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const dpGitCountSnapshot = (root) =>
      root
        ? Array.from(root.querySelectorAll(".git-branch-summary-row .git-branch-summary-count"))
            .map((el) => Math.max(0, parseInt(el.dataset.countValue || el.textContent || "0") || 0))
        : [];
    const dpAnimateGitCount = (el, fromValue, toValue) => {
      const prefix = el.dataset.countPrefix || "";
      const from = Math.max(0, parseInt(fromValue) || 0);
      const to = Math.max(0, parseInt(toValue) || 0);
      if (!dpShouldAnimateGitCounts() || from === to) {
        el.textContent = `${prefix}${to}`;
        return;
      }
      const duration = 1000;
      const started = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - started) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const value = Math.round(from + (to - from) * eased);
        el.textContent = `${prefix}${value}`;
        if (t < 1) requestAnimationFrame(tick);
        else el.textContent = `${prefix}${to}`;
      };
      el.textContent = `${prefix}${from}`;
      requestAnimationFrame(tick);
    };
    const dpAnimateGitCountsFromSnapshot = (root, previous) => {
      if (!root || !previous?.length) return;
      root.querySelectorAll(".git-branch-summary-row .git-branch-summary-count").forEach((el, idx) => {
        if (idx >= previous.length) return;
        dpAnimateGitCount(el, previous[idx], el.dataset.countValue || el.textContent || "0");
      });
    };
    const dpRenderGitSummaryRoot = (root, rowHtml) => {
      if (!root) return;
      const previous = dpGitCountSnapshot(root);
      root.innerHTML = rowHtml;
      dpApplySummaryPinButtonPressed(root);
      dpAnimateGitCountsFromSnapshot(root, previous);
    };
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
    const dpApplyGitOverviewHeader = () => {
      const rowHtml = dpGitHeaderSummaryState?.rowHtml || "";
      const panelWrap = dpGitContent?.querySelector(".git-branch-summary-wrap");
      const aside = document.getElementById("gitPinnedSummaryAside");
      const inner = document.getElementById("gitPinnedSummaryInner");
      const overlay = hasDesktopRightPanelOverlay();
      const stripShown = !!dpGitSummaryPinned && !dpPanelOpen;

      if (overlay && aside && inner) {
        aside.hidden = !stripShown;
      }

      if (stripShown && inner && overlay) {
        dpRenderGitSummaryRoot(inner, rowHtml);
      } else if (dpPanelOpen && panelWrap) {
        dpRenderGitSummaryRoot(panelWrap, rowHtml);
      } else if (panelWrap) {
        dpRenderGitSummaryRoot(panelWrap, rowHtml);
      }

      if (overlay && aside && inner) dpApplyPanelWidth();
    };
    const dpSyncPinnedSummaryStrip = () => {
      dpApplyGitOverviewHeader();
    };
