    dpGitContent?.addEventListener("click", async (event) => {
      await gitSession.handleClick(event, {
        onPin: () => dpToggleGitSummaryPinned(),
        requireOpen: () => dpPanelOpen,
        onFileRow: async (fileRow) => {
          const p = String(fileRow.dataset.path || "").trim();
          if (!p) return;
          const isUncommittedRow = !!fileRow.closest(".git-commit-file-section");
          const isUntracked = fileRow.dataset.untracked === "1";
          if (isUncommittedRow && !isUntracked) {
            await dpPostOpenDiff(p);
            return;
          }
          await dpPostOpenFile(p);
        },
        closeWorktreeSummaryClick: true,
      });
    });
    dpGitContent?.addEventListener("contextmenu", (event) => {
      const fileRow = event.target.closest(".git-commit-file-row");
      const path = String(fileRow?.dataset.path || "").trim();
      if (path) void dpOpenFileContextMenu(path, event);
    });
    document.getElementById("gitPinnedSummaryAside")?.addEventListener("click", async (event) => {
      if (event.target.closest(".git-summary-pin")) {
        event.preventDefault();
        event.stopPropagation();
        dpToggleGitSummaryPinned();
        return;
      }
      const row = event.target.closest('.git-summary-row[data-diff-kind="worktree"]');
      if (!row || !dpGitContent) return;
      event.preventDefault();
      event.stopPropagation();
      const needReset = !dpGitContent.querySelector(".git-stack");
      await openDesktopRightPanel({ view: "git", reset: needReset });
      await dpOpenGitDetail({
        diffKind: "worktree",
        hash: "",
        rowHtml: row.outerHTML,
        subject: row.querySelector(".git-summary-label")?.textContent?.trim() || "Uncommitted changes",
      });
    });

    (function initPinnedSummaryExpand() {
      const aside = document.getElementById("gitPinnedSummaryAside");
      if (!aside) return;

      const expand = document.createElement("div");
      expand.className = "git-pinned-expand";
      aside.appendChild(expand);

      // Fade the top/bottom edges of the scrolled file list, like the hub's
      // hover popover (see computeScrollFadeState in home.js).
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
        expand.innerHTML = "";
      }

      function refreshContent() {
        if (refreshPromise) return refreshPromise;
        if (!dpGitHeaderSummaryState?.clickable) {
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

            replaceExpandContent(sections.map(s =>
              `<div class="git-pinned-expand-section">` +
              gitCommitFileListHtml(s.files) +
              `</div>`
            ).join(""));
          } catch (_) {
            if (seq !== fetchSeq) return;
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
        if (!dpGitHeaderSummaryState?.clickable) {
          close({ clear: true });
          return;
        }
        aside.classList.add("is-expanded");
        if (expand.firstElementChild) {
          cancelExpandAnimation();
          animateExpandFrom(0);
        }
        void refreshContent();
      }

      // The summary row's own counts already refresh whenever a workspace
      // sync event reports the git state changed (dpApplyGitOverviewHeader),
      // Keep the content ready while the pin is visible so hover can begin
      // expanding immediately. The same event refreshes an open popover in
      // place when the worktree changes.
      dpPinnedExpandRefresh = () => {
        if (!aside.hidden) void refreshContent();
      };

      expand.addEventListener("click", (event) => {
        const file = event.target.closest(".git-commit-file-row");
        if (!file) return;
        const path = file.dataset.path || "";
        if (!path) return;
        if (file.dataset.untracked !== "1") {
          void dpPostOpenDiff(path);
          return;
        }
        void dpPostOpenFile(path);
      });

      expand.addEventListener("contextmenu", (event) => {
        const file = event.target.closest(".git-commit-file-row");
        const path = String(file?.dataset.path || "").trim();
        if (path) void dpOpenFileContextMenu(path, event);
      });

      aside.addEventListener("mouseenter", open);
      aside.addEventListener("mouseleave", () => { cancelTimers(); closeTimer = setTimeout(close, 60); });
    })();
