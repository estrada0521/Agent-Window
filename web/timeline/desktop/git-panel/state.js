    const gitSummaryPinnedStorageKey = () => `agent_window_git_summary_pinned:${String(currentTimelineName || "").trim() || "__none"}`;
    let gitSummaryPinned = true;
    const pinnedStripActive = () =>
      gitSummaryPinned && document.documentElement.dataset.autoWindowHeight !== "1";
    let pinnedExpandRefresh = null;
    let pinnedExpandSections = null;
    let _gitSummaryPinnedLoadedForKey = "";
    const readGitSummaryPinnedFromStorage = () => {
      const stored = localStorage.getItem(gitSummaryPinnedStorageKey());
      gitSummaryPinned = stored === null ? true : stored === "1";
    };
    const applySummaryPinButtonPressed = (root) => {
      if (!root) return;
      root.querySelectorAll(".git-summary-pin").forEach((btn) => {
        btn.setAttribute("aria-pressed", gitSummaryPinned ? "true" : "false");
        btn.classList.toggle("is-pinned", gitSummaryPinned);
        btn.title = gitSummaryPinned ? "Unpin from Timeline [⇧⌘P]" : "Pin to Timeline [⇧⌘P]";
      });
    };
    const renderGitSummaryRoot = (root, rowHtml, { animateCounts = true } = {}) => {
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
          applySummaryPinButtonPressed(root);
          return;
        }
      }
      const previous = gitCountSnapshot(root);
      root.innerHTML = rowHtml;
      applySummaryPinButtonPressed(root);
      if (animateCounts) animateGitCountsFromSnapshot(root, previous);
    };
    let gitHeaderSummaryState = null;
    const applyGitOverviewHeader = () => {
      const rowHtml = gitHeaderSummaryState?.rowHtml || "";
      const panelWrap = gitContent?.querySelector(".git-summary-wrap");
      const aside = document.getElementById("gitPinnedSummaryAside");
      const inner = document.getElementById("gitPinnedSummaryInner");
      const stripShown = pinnedStripActive() && !sideBarOpen;
      aside.hidden = !stripShown;
      renderGitSummaryRoot(inner, rowHtml, { animateCounts: stripShown });
      if (stripShown) pinnedExpandRefresh?.();
      if (panelWrap) renderGitSummaryRoot(panelWrap, rowHtml, { animateCounts: sideBarOpen });
      applySideBarWidth();
    };
    const syncPinnedSummaryStrip = () => {
      applyGitOverviewHeader();
    };
