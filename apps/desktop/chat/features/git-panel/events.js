    dpGitContent?.addEventListener("click", async (event) => {
      await gitSession.handleClick(event, {
        onPin: () => dpToggleGitSummaryPinned(),
        requireOpen: () => dpPanelOpen,
        onFileRow: async (fileRow) => {
          const p = String(fileRow.dataset.path || "").trim();
          if (!p) return;
          const hash = gitSession.detailContext?.hash || "";
          if (hash || fileRow.dataset.untracked !== "1") await dpPostOpenDiff(p, hash, fileRow.dataset.oldPath || "");
          else await dpPostOpenFile(p);
        },
        closeWorktreeSummaryClick: true,
      });
    });
    const dpCommitTitles = new Map();
    const dpCommitTitle = (hash) => {
      if (!dpCommitTitles.has(hash)) {
        dpCommitTitles.set(hash, fetchGitJson(`/git-commit-info?hash=${encodeURIComponent(hash)}`).then(
          (info) => [`${info.author}, ${new Date(info.date).toLocaleString()}`, info.message, info.stat, hash].filter(Boolean).join("\n\n"),
          (err) => {
            dpCommitTitles.delete(hash);
            throw err;
          },
        ));
      }
      return dpCommitTitles.get(hash);
    };
    dpGitContent?.addEventListener("mouseover", async (event) => {
      const row = event.target.closest(".git-commit-row");
      const hash = String(row?.dataset.hash || "");
      if (!hash || row.title) return;
      row.title = await dpCommitTitle(hash);
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
        const wasExpanded = aside.classList.contains("is-expanded");
        aside.classList.add("is-expanded");
        if (!wasExpanded && expand.firstElementChild) {
          cancelExpandAnimation();
          animateExpandFrom(0);
        }
        void refreshContent();
      }

      dpPinnedExpandRefresh = () => {
        if (!aside.hidden) void refreshContent();
      };

      expand.addEventListener("click", (event) => {
        const file = event.target.closest(".git-commit-file-row");
        if (!file) return;
        const path = file.dataset.path || "";
        if (!path) return;
        if (file.dataset.untracked !== "1") {
          void dpPostOpenDiff(path, "", file.dataset.oldPath || "");
          return;
        }
        void dpPostOpenFile(path);
      });

      expand.addEventListener("contextmenu", (event) => {
        const file = event.target.closest(".git-commit-file-row");
        const path = String(file?.dataset.path || "").trim();
        if (path) void dpOpenFileContextMenu(path, event);
      });

      summary.addEventListener("mouseover", (event) => {
        const row = event.target.closest(".git-summary-row");
        const from = event.relatedTarget;
        if (!row || !summary.contains(row) || (from instanceof Node && row.contains(from))) return;
        open();
      });
      aside.addEventListener("mouseleave", () => { cancelTimers(); closeTimer = setTimeout(close, 60); });
    })();
