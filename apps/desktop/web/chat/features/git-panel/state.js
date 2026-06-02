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
    const dpAlignCountDigits = (from, to) => {
      const fromStr = String(Math.max(0, parseInt(from) || 0));
      const toStr = String(Math.max(0, parseInt(to) || 0));
      const maxLen = Math.max(fromStr.length, toStr.length);
      const cols = [];
      for (let i = 0; i < maxLen; i++) {
        const fromIdx = fromStr.length - maxLen + i;
        const toIdx = toStr.length - maxLen + i;
        cols.push({
          start: fromIdx >= 0 ? parseInt(fromStr[fromIdx], 10) : 0,
          end: parseInt(toStr[toIdx], 10),
        });
      }
      return cols;
    };
    const dpBuildCountRollHtml = (prefix, columns) => {
      const digitHtml = columns.map(({ start }) => {
        const items = Array.from({ length: 10 }, (_, d) =>
          `<span class="git-count-roll-item">${d}</span>`
        ).join("");
        return `<span class="git-count-roll-digit"><span class="git-count-roll-strip" style="transform:translateY(calc(${start} * -1.2em))">${items}</span></span>`;
      }).join("");
      return `<span class="git-count-roll"><span class="git-count-roll-prefix">${prefix}</span><span class="git-count-roll-digits">${digitHtml}</span></span>`;
    };
    const dpAnimateGitCount = (el, fromValue, toValue) => {
      const prefix = el.dataset.countPrefix || "";
      const from = Math.max(0, parseInt(fromValue) || 0);
      const to = Math.max(0, parseInt(toValue) || 0);
      if (!dpShouldAnimateGitCounts() || from === to) {
        el.textContent = `${prefix}${to}`;
        return;
      }
      const columns = dpAlignCountDigits(from, to);
      if (!columns.length) {
        el.textContent = `${prefix}${to}`;
        return;
      }
      const durationMs = 900;
      const staggerMs = 70;
      el.innerHTML = dpBuildCountRollHtml(prefix, columns);
      el.classList.add("is-rolling");
      const strips = Array.from(el.querySelectorAll(".git-count-roll-strip"));
      const finish = () => {
        el.classList.remove("is-rolling");
        el.textContent = `${prefix}${to}`;
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          strips.forEach((strip, i) => {
            const end = columns[i].end;
            strip.style.transition = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
            strip.style.transitionDelay = `${i * staggerMs}ms`;
            strip.style.transform = `translateY(calc(${end} * -1.2em))`;
          });
        });
      });
      window.setTimeout(finish, durationMs + (columns.length - 1) * staggerMs + 48);
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
