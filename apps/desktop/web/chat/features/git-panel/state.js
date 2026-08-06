    const DP_GIT_BATCH = 50;
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
          end: toIdx >= 0 ? parseInt(toStr[toIdx], 10) : 0,
        });
      }
      return cols;
    };
    const dpVisibleCountRollColumns = (cols, to) => {
      const toNum = Math.max(0, parseInt(to) || 0);
      if (!cols.length) return cols;
      if (toNum === 0) {
        const firstNonZero = cols.findIndex((col) => col.start !== 0);
        return [cols[firstNonZero >= 0 ? firstNonZero : cols.length - 1]];
      }
      const toLen = String(toNum).length;
      return cols.slice(-Math.min(cols.length, toLen));
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
      const columns = dpVisibleCountRollColumns(dpAlignCountDigits(from, to), to);
      if (!columns.length || columns.every((col) => col.start === col.end)) {
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
