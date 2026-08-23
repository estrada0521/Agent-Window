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
      root.querySelectorAll(".git-summary-pin").forEach((btn) => {
        btn.setAttribute("aria-pressed", dpGitSummaryPinned ? "true" : "false");
        btn.classList.toggle("is-pinned", dpGitSummaryPinned);
        btn.title = dpGitSummaryPinned ? "Unpin from Chat" : "Pin to Chat";
      });
    };
    const dpRenderGitSummaryRoot = (root, rowHtml) => {
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
            animateGitCount(countEl, prevValue, nextValue);
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
      animateGitCountsFromSnapshot(root, previous);
    };
    const dpSummaryCountsKey = (state) =>
      Array.isArray(state?.counts) ? state.counts.map((value) => Math.max(0, parseInt(value) || 0)).join(":") : "";
    let dpGitHeaderSummaryState = null;
    let dpGitAppliedSummaryCountsKey = "";
    const dpApplyGitOverviewHeader = () => {
      const rowHtml = dpGitHeaderSummaryState?.rowHtml || "";
      const countsKey = dpSummaryCountsKey(dpGitHeaderSummaryState);
      const shouldAnimate = countsKey !== dpGitAppliedSummaryCountsKey;
      const panelWrap = dpGitContent?.querySelector(".git-summary-wrap");
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
