    gitContent?.addEventListener("click", async (event) => {
      await gitPanel.handleClick(event, {
        onPin: () => toggleGitSummaryPinned(),
        requireOpen: () => sideBarOpen,
        onFileRow: async (fileRow) => {
          const p = String(fileRow.dataset.path || "").trim();
          if (!p) return;
          const resolved = resolveRowClick(gitSel, p, event);
          if (!resolved) return;
          if (resolved.quickLook) {
            await quickLookPaths(resolved.targets.map(gitTreePath));
            return;
          }
          const hash = gitPanel.detailContext?.hash || "";
          for (const path of resolved.targets) {
            const row = gitContent?.querySelector(`.git-commit-file-row[data-path="${gitCssEscape(path)}"]`);
            if (hash || row?.dataset.untracked !== "1") await openDiff(path, hash, row?.dataset.oldPath || "");
            else await openFile(gitTreePath(path));
          }
        },
        closeWorktreeSummaryClick: true,
      });
    });
    gitContent?.addEventListener("mouseover", async (event) => {
      const summaryRow = event.target.closest(".git-summary-row");
      if (summaryRow) {
        if (summaryRow.contains(event.relatedTarget)) return;
        const { stat } = await fetchGitJson("/git-worktree-stat");
        summaryRow.title = stat || "No changes";
        return;
      }
      const head = event.target.closest(".git-commit-detail-head");
      const target = head || event.target.closest(".git-commit-row");
      const hash = String((head ? gitPanel.detailContext?.hash : target?.dataset.hash) || "");
      if (!hash) return;
      const info = await gitCommitInfo(hash);
      const text = [`${info.author}, ${new Date(info.date).toLocaleString()}`, info.message, info.stat, info.hash].filter(Boolean).join("\n\n");
      if (target.title !== text) target.title = text;
    });
    gitContent?.addEventListener("contextmenu", (event) => {
      const hash = String(event.target.closest(".git-commit-row")?.dataset.hash
        || (event.target.closest(".git-commit-detail-head") ? gitPanel.detailContext?.hash : "")
        || "");
      if (hash) {
        openCommitContextMenu(hash, event);
        return;
      }
      const fileRow = event.target.closest(".git-commit-file-row");
      const path = String(fileRow?.dataset.path || "").trim();
      if (!path) return;
      void openFileContextMenu(resolveContextMenuTargets(gitSel, path).map(gitTreePath), event, { openFile: fileRow.dataset.untracked !== "1", triggerPath: gitTreePath(path) });
    });
    document.getElementById("gitPinnedSummaryAside")?.addEventListener("click", async (event) => {
      if (event.target.closest(".git-summary-pin")) {
        event.preventDefault();
        event.stopPropagation();
        toggleGitSummaryPinned();
        return;
      }
      const row = event.target.closest(".git-summary-row");
      if (!row || !gitContent) return;
      event.preventDefault();
      event.stopPropagation();
      if (row.dataset.diffKind !== "worktree") {
        void openSideBar({ view: "git", reset: false });
        return;
      }
      const aside = document.getElementById("gitPinnedSummaryAside");
      const seedSections = Array.isArray(pinnedExpandSections) ? pinnedExpandSections : null;
      const useSeed = !!(aside?.classList.contains("is-expanded") && seedSections?.length);
      if (!gitContent.querySelector(".git-stack")) {
        renderGitShell();
        gitPanel.invalidateFingerprint();
        applyGitOverviewHeader();
      }
      await openGitDetail({
        diffKind: "worktree",
        hash: "",
        rowHtml: row.outerHTML,
        subject: "Uncommitted changes",
        instant: true,
        seed: useSeed ? { mode: "sections", sections: seedSections } : null,
      });
      void openSideBar({ view: "git", reset: false });
    });

    (function initPinnedSummaryExpand() {
      const aside = document.getElementById("gitPinnedSummaryAside");
      const summary = document.getElementById("gitPinnedSummaryInner");
      if (!aside || !summary) return;

      const expand = document.createElement("div");
      expand.className = "git-pinned-expand";
      aside.appendChild(expand);

      const updateExpandFade = () => {
        const { scrollTop, scrollHeight, clientHeight } = expand;
        if (scrollHeight <= clientHeight + 1) { expand.dataset.scrollFade = "none"; return; }
        const atTop = scrollTop <= 1;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
        expand.dataset.scrollFade = atTop && !atBottom ? "bottom" : atBottom && !atTop ? "top" : "both";
      };
      expand.addEventListener("scroll", updateExpandFade, { passive: true });

      let closeTimer = null;
      let fetchSeq = 0;
      let refreshPromise = null;
      let expandAnimation = null;

      function cancelTimers() {
        clearTimeout(closeTimer); closeTimer = null;
      }

      function cancelExpandAnimation() {
        expandAnimation?.cancel();
        expandAnimation = null;
      }

      function animateExpandFrom(startHeight) {
        const targetHeight = expand.getBoundingClientRect().height;
        updateExpandFade();
        if (typeof expand.animate !== "function") return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
        if (Math.abs(targetHeight - startHeight) < 0.5) return;
        const animation = expand.animate([
          { height: `${startHeight}px` },
          { height: `${targetHeight}px` },
        ], {
          duration: 150,
          easing: "ease",
          fill: "both",
        });
        expandAnimation = animation;
        animation.addEventListener("finish", () => {
          if (expandAnimation !== animation) return;
          animation.cancel();
          expandAnimation = null;
        }, { once: true });
      }

      function replaceExpandContent(html) {
        const shouldAnimate = aside.classList.contains("is-expanded");
        const startHeight = shouldAnimate ? expand.getBoundingClientRect().height : 0;
        cancelExpandAnimation();
        expand.innerHTML = html;
        if (shouldAnimate) animateExpandFrom(startHeight);
      }

      function close({ clear = false } = {}) {
        cancelTimers();
        cancelExpandAnimation();
        aside.classList.remove("is-expanded");
        expand.dataset.scrollFade = "none";
        if (!clear) return;
        fetchSeq++;
        refreshPromise = null;
        pinnedExpandSections = null;
        expand.innerHTML = "";
      }

      function refreshContent() {
        if (refreshPromise) return refreshPromise;
        if (!gitHeaderSummaryState?.clickable) {
          close({ clear: true });
          return Promise.resolve();
        }
        const seq = fetchSeq;

        const promise = (async () => {
          try {
            const { sections } = await fetchGitWorktreeFileSections();
            if (seq !== fetchSeq) return;

            if (!sections.length) {
              close({ clear: true });
              return;
            }

            pinnedExpandSections = sections;
            replaceExpandContent(sections.map(s =>
              `<div class="git-pinned-expand-section">` +
              gitCommitFileListHtml(s.files) +
              `</div>`
            ).join(""));
          } catch (_) {
            if (seq !== fetchSeq) return;
            pinnedExpandSections = null;
            replaceExpandContent(`<div class="git-pinned-expand-empty">Failed to load</div>`);
          }
          requestAnimationFrame(updateExpandFade);
        })();
        refreshPromise = promise;
        void promise.finally(() => {
          if (refreshPromise === promise) refreshPromise = null;
        });
        return promise;
      }

      function open() {
        cancelTimers();
        if (aside.hidden) return;
        if (!gitHeaderSummaryState?.clickable) {
          close({ clear: true });
          return;
        }
        const wasExpanded = aside.classList.contains("is-expanded");
        aside.classList.add("is-expanded");
        if (!wasExpanded && expand.firstElementChild) {
          cancelExpandAnimation();
          animateExpandFrom(0);
        }
        void refreshContent();
      }

      pinnedExpandRefresh = () => {
        if (!aside.hidden) void refreshContent();
      };

      expand.addEventListener("click", (event) => {
        const file = event.target.closest(".git-commit-file-row");
        if (!file) return;
        const path = file.dataset.path || "";
        if (!path) return;
        if (file.dataset.untracked !== "1") {
          void openDiff(path, "", file.dataset.oldPath || "");
          return;
        }
        void openFile(gitTreePath(path));
      });

      expand.addEventListener("contextmenu", (event) => {
        const file = event.target.closest(".git-commit-file-row");
        const path = String(file?.dataset.path || "").trim();
        if (path) void openFileContextMenu(gitTreePath(path), event, { openFile: file.dataset.untracked !== "1" });
      });

      summary.addEventListener("mouseover", (event) => {
        const row = event.target.closest(".git-summary-row");
        const from = event.relatedTarget;
        if (!row || !summary.contains(row) || (from instanceof Node && row.contains(from))) return;
        open();
      });
      aside.addEventListener("mouseleave", () => { cancelTimers(); closeTimer = setTimeout(close, 60); });
    })();
