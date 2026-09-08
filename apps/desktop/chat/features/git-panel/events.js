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
      const inner = document.getElementById("gitPinnedSummaryInner");
      if (!aside || !inner) return;

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

      let openTimer = null;
      let closeTimer = null;
      let fetchSeq = 0;

      function cancelTimers() {
        clearTimeout(openTimer); openTimer = null;
        clearTimeout(closeTimer); closeTimer = null;
      }

      function animatePopoverIn(popover, stableElement) {
        if (!popover || typeof popover.animate !== "function") return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

        const frames = [];
        const stableFrames = [];
        const steps = 48;
        const frequency = Math.PI * 2.55;
        const damping = 3.8;
        for (let i = 0; i <= steps; i += 1) {
          const progress = i / steps;
          const decay = Math.exp(-damping * progress);
          const wave = Math.sin((frequency * progress) - (Math.PI / 2));
          let scaleX = 1;
          let scaleY = 1 + (0.24 * decay * wave);
          if (i === steps) {
            scaleX = 1;
            scaleY = 1;
          }
          frames.push({
            transform: `scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`,
          });
          if (stableElement) {
            stableFrames.push({
              transform: `scale(1, ${ (1/scaleY).toFixed(4) })`
            });
          }
        }
        const animation = popover.animate(frames, {
          duration: 360,
          easing: "linear",
          fill: "both",
        });
        if (stableElement && stableFrames.length) {
          stableElement.animate(stableFrames, {
            duration: 360,
            easing: "linear",
            fill: "both",
          });
        }
        animation.addEventListener("finish", () => {
          popover.style.transform = "";
          if (stableElement) stableElement.style.transform = "";
        }, { once: true });
      }

      function close() {
        cancelTimers();
        aside.classList.remove("is-expanded");
        fetchSeq++;
        expand.innerHTML = "";
        expand.dataset.scrollFade = "none";
      }

      async function refreshContent() {
        if (!dpGitHeaderSummaryState?.clickable) {
          close();
          return;
        }
        const seq = ++fetchSeq;
        expand.innerHTML = `<div class="git-pinned-expand-loading"><span></span><span></span><span></span></div>`;

        try {
          const { sections } = await fetchGitWorktreeFileSections();
          if (seq !== fetchSeq) return;

          if (!sections.length) {
            close();
            return;
          }

          expand.innerHTML = sections.map(s =>
            `<div class="git-pinned-expand-section">` +
            gitCommitFileListHtml(s.files) +
            `</div>`
          ).join("");
        } catch (_) {
          if (seq !== fetchSeq) return;
          expand.innerHTML = `<div class="git-pinned-expand-empty">Failed to load</div>`;
        }
        requestAnimationFrame(updateExpandFade);
      }

      async function open() {
        cancelTimers();
        if (aside.hidden) return;
        if (!dpGitHeaderSummaryState?.clickable) {
          close();
          return;
        }
        aside.classList.add("is-expanded");
        animatePopoverIn(aside, inner);
        await refreshContent();
      }

      // The summary row's own counts already refresh whenever a workspace
      // sync event reports the git state changed (dpApplyGitOverviewHeader),
      // but this popover only ever fetched once, when the mouse first opened
      // it -- a commit landing while it's still open left it showing files
      // that no longer differ. Re-run the fetch in place (no re-triggered
      // pop-in animation) on that same event, if it's open.
      dpPinnedExpandRefresh = () => {
        if (aside.classList.contains("is-expanded")) void refreshContent();
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

      aside.addEventListener("mouseenter", () => { cancelTimers(); openTimer = setTimeout(open, 60); });
      aside.addEventListener("mouseleave", () => { cancelTimers(); closeTimer = setTimeout(close, 60); });
    })();
