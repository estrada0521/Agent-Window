    const dpGitSummaryPinnedStorageKey = () => `agent_window_git_summary_pinned:${String(currentSessionName || "").trim() || "__none"}`;
    let dpGitSummaryPinned = true;
    const dpPinnedStripActive = () =>
      dpGitSummaryPinned && document.documentElement.dataset.autoWindowHeight !== "1";
    let dpPinnedExpandRefresh = null;
    let dpPinnedExpandSections = null;
    let _dpGitSummaryPinnedLoadedForKey = "";
    const dpReadGitSummaryPinnedFromStorage = () => {
      const stored = localStorage.getItem(dpGitSummaryPinnedStorageKey());
      dpGitSummaryPinned = stored === null ? true : stored === "1";
    };
    const dpApplySummaryPinButtonPressed = (root) => {
      if (!root) return;
      root.querySelectorAll(".git-summary-pin").forEach((btn) => {
        btn.setAttribute("aria-pressed", dpGitSummaryPinned ? "true" : "false");
        btn.classList.toggle("is-pinned", dpGitSummaryPinned);
        btn.title = dpGitSummaryPinned ? "Unpin from Chat [⇧⌘P]" : "Pin to Chat [⇧⌘P]";
      });
    };
    const dpRenderGitSummaryRoot = (root, rowHtml, { animateCounts = true } = {}) => {
      if (!root) return;
      const existingRow = root.querySelector(".git-summary-row");
      if (existingRow && rowHtml) {
        const temp = document.createElement("div");
        temp.innerHTML = rowHtml;
        const nextRow = temp.querySelector(".git-summary-row");
        if (nextRow) {
          existingRow.className = nextRow.className;
          if (nextRow.dataset.diffKind) existingRow.dataset.diffKind = nextRow.dataset.diffKind;
          else delete existingRow.dataset.diffKind;
          const existingMeta = existingRow.querySelector(".git-summary-meta-text");
          const nextMeta = nextRow.querySelector(".git-summary-meta-text");
          if (existingMeta && nextMeta && existingMeta.textContent !== nextMeta.textContent) {
            existingMeta.textContent = nextMeta.textContent;
          }
          const existingCounts = Array.from(existingRow.querySelectorAll(".git-summary-count"));
          const nextCounts = Array.from(nextRow.querySelectorAll(".git-summary-count"));
          existingCounts.forEach((countEl, idx) => {
            const nextCount = nextCounts[idx];
            if (!nextCount) return;
            const nextValue = Math.max(0, parseInt(nextCount.dataset.countValue || nextCount.textContent || "0") || 0);
            const prevValue = Math.max(0, parseInt(countEl.dataset.countValue || countEl.textContent || "0") || 0);
            countEl.dataset.countValue = String(nextValue);
            animateGitCount(countEl, prevValue, nextValue, { animate: animateCounts });
          });
          const existingChevron = existingRow.querySelector(".git-commit-chevron");
          const nextChevron = nextRow.querySelector(".git-commit-chevron");
          if (existingChevron && !nextChevron) existingChevron.remove();
          else if (!existingChevron && nextChevron) existingRow.appendChild(nextChevron.cloneNode(true));
          dpApplySummaryPinButtonPressed(root);
          return;
        }
      }
      const previous = gitCountSnapshot(root);
      root.innerHTML = rowHtml;
      dpApplySummaryPinButtonPressed(root);
      if (animateCounts) animateGitCountsFromSnapshot(root, previous);
    };
    let dpGitHeaderSummaryState = null;
    const dpApplyGitOverviewHeader = () => {
      const rowHtml = dpGitHeaderSummaryState?.rowHtml || "";
      const panelWrap = dpGitContent?.querySelector(".git-summary-wrap");
      const aside = document.getElementById("gitPinnedSummaryAside");
      const inner = document.getElementById("gitPinnedSummaryInner");
      const stripShown = dpPinnedStripActive() && !dpPanelOpen;
      aside.hidden = !stripShown;
      dpRenderGitSummaryRoot(inner, rowHtml, { animateCounts: stripShown });
      if (stripShown) dpPinnedExpandRefresh?.();
      if (panelWrap) dpRenderGitSummaryRoot(panelWrap, rowHtml, { animateCounts: dpPanelOpen });
      dpApplyPanelWidth();
    };
    const dpSyncPinnedSummaryStrip = () => {
      dpApplyGitOverviewHeader();
    };
