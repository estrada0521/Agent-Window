__INCLUDE:../../list-flip.js__
__INCLUDE:../git-panel-html.js__
__INCLUDE:../git-panel-data.js__
__INCLUDE:../git-panel-controller.js__
    const gitSheetTitleEl = () => sharedSheetTitleEl;
    let gitSheetBranch = "";
    const setGitSheetTitle = () => {
      const titleEl = gitSheetTitleEl();
      if (!titleEl) return;
      titleEl.classList.remove("git-sheet-detail-title", "git-sheet-title");
      titleEl.textContent = gitSheetBranch || "Git";
      titleEl.title = titleEl.textContent;
    };
    const syncGitSheetBranch = (data) => {
      gitSheetBranch = data?.branch || "";
      if (sheetKind() === "git" && !gitPanel.detailContext && !mobileSheet.classList.contains("sheet-mode-preview")) setGitSheetTitle();
    };
    const gitWorktreeButton = () => mobileSheet?.querySelector(".git-worktree-button");
    const gitPinButton = document.createElement("button");
    gitPinButton.type = "button";
    gitPinButton.className = "git-summary-pin mobile-bottom-sheet-button";
    gitPinButton.hidden = true;
    gitPinButton.innerHTML = GIT_SUMMARY_PIN_SVG;
    let gitWorktreeList = [];
    const gitTreeButton = document.createElement("button");
    gitTreeButton.type = "button";
    gitTreeButton.className = "git-tree-switch mobile-bottom-sheet-button";
    gitTreeButton.setAttribute("aria-label", "Switch worktree");
    gitTreeButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M6.60 8.36L8.75 5.38C9.08 4.93 8.86 4.57 8.32 4.56L5.20 4.51C4.76 4.50 4.52 4.82 4.67 5.24L5.67 8.19C5.85 8.71 6.26 8.82 6.60 8.36ZM11.31 18.81C11.31 19.20 11.62 19.50 12.00 19.50C12.37 19.50 12.68 19.20 12.68 18.81L12.68 14.14C12.68 10.62 10.71 7.58 7.24 5.69C6.83 5.46 6.46 5.68 6.30 6.00C6.17 6.30 6.22 6.68 6.58 6.89C9.65 8.56 11.31 11.15 11.31 14.14ZM17.39 8.36C17.73 8.82 18.14 8.71 18.31 8.19L19.32 5.24C19.48 4.82 19.23 4.50 18.80 4.51L15.67 4.56C15.13 4.57 14.91 4.93 15.24 5.38ZM12.68 18.81L12.68 14.14C12.68 11.15 14.35 8.56 17.42 6.89C17.78 6.68 17.83 6.30 17.70 6.00C17.54 5.68 17.17 5.46 16.76 5.69C13.29 7.58 11.31 10.62 11.31 14.14L11.31 18.81C11.31 19.20 11.62 19.50 12.00 19.50C12.37 19.50 12.68 19.20 12.68 18.81Z"/></svg>';
    const loadGitWorktreeList = async () => {
      gitWorktreeList = await fetchGitWorktrees();
    };
    gitTreeButton.addEventListener("click", () => {
      if (gitWorktreeList.length < 2) {
        setStatus("No other worktrees");
        return;
      }
      openSubMenu(
        "Worktree",
        gitWorktreeList.map((tree, index) => [String(index), `${tree.path === gitTree() ? "✓ " : ""}${tree.branch}`]),
        (index) => setGitTree(gitWorktreeList[Number(index)].path),
      );
    });
    const gitPinHud = document.createElement("button");
    gitPinHud.type = "button";
    gitPinHud.className = "git-worktree-button";
    gitPinHud.setAttribute("aria-label", "Open uncommitted changes");
    const gitPinStorageKey = () => `agent_window_mobile_git_summary_pinned:${currentTimelineName}`;
    const gitPinned = () => localStorage.getItem(gitPinStorageKey()) === "1";
    const syncGitPinButton = () => {
      const pinned = gitPinned();
      gitPinButton.classList.toggle("is-pinned", pinned);
      gitPinButton.setAttribute("aria-pressed", pinned ? "true" : "false");
      gitPinButton.setAttribute("aria-label", pinned ? "Unpin Git summary" : "Pin Git summary");
    };
    const showGitWorktreeButton = () => {
      const btn = gitWorktreeButton();
      if (btn) btn.hidden = gitTreeButton.hidden = !!gitPanel.detailContext;
      gitPinButton.hidden = true;
    };
    const hideGitWorktreeButton = () => {
      const btn = gitWorktreeButton();
      if (btn) btn.hidden = gitPinButton.hidden = gitTreeButton.hidden = true;
    };
    const gitWorktreeSummaryHtml = (data) => {
      const changedPaths = Math.max(0, parseInt(data?.worktree_changed_paths) || 0);
      const added = Math.max(0, parseInt(data?.worktree_added) || 0);
      const deleted = Math.max(0, parseInt(data?.worktree_deleted) || 0);
      return `<span class="git-worktree-button-label">${gitPathCountText(changedPaths)}</span>${gitCountsHtml(added, deleted)}`;
    };
    const renderGitPinHud = (data, { animate = true } = {}) => {
      const previous = gitCountSnapshot(gitPinHud);
      gitPinHud.innerHTML = gitWorktreeSummaryHtml(data);
      if (animate) animateGitCountsFromSnapshot(gitPinHud, previous);
    };
    const refreshGitPinHud = async () => {
      if (!gitPinned()) {
        setBackgroundStatus(null);
        return;
      }
      try {
        const data = await fetchGitOverview({ summary: true });
        renderGitPinHud(data);
        if (gitWorktreeButton()) renderGitWorktreeButton(data);
        setBackgroundStatus(gitPinHud);
      } catch (err) {
        setStatus(err?.message || "Failed to load Git summary");
      }
    };
    gitPinButton.addEventListener("click", () => {
      localStorage.setItem(gitPinStorageKey(), gitPinned() ? "0" : "1");
      syncGitPinButton();
      void refreshGitPinHud();
    });
    gitPinHud.addEventListener("click", async () => {
      _ignoreGlobalClick = true;
      await openGitSheet();
      gitWorktreeButton()?.click();
    });
    const animateGitSheetList = (selector, transition) => {
      const list = gitHostEl()?.querySelector(selector);
      if (!list) return;
      delete list.dataset.transition;
      void list.offsetWidth;
      list.dataset.transition = transition;
    };
    const revealFilesFromTop = (wrapEl) => {
      wrapEl?.querySelectorAll(".git-commit-file-row").forEach((row, i) => {
        row.style.setProperty("--file-reveal-i", Math.min(i, 6));
        row.classList.add("git-file-reveal-in");
      });
    };
    const renderGitWorktreeButton = (data) => {
      let btn = gitWorktreeButton();
      if (!btn) {
        const sheetPanel = mobileSheet?.querySelector(".mobile-bottom-sheet-panel");
        if (!sheetPanel) return;
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "git-worktree-button mobile-bottom-sheet-button";
        sheetPanel.append(btn, gitTreeButton, gitPinButton);
      }
      syncGitPinButton();
      const hasDiff = !!data?.worktree_has_diff;
      btn.disabled = !hasDiff;
      btn.classList.toggle("clickable", hasDiff);
      if (hasDiff) btn.dataset.diffKind = "worktree";
      else delete btn.dataset.diffKind;
      btn.setAttribute("aria-label", hasDiff ? "Open uncommitted changes" : "Working tree clean");
      btn.innerHTML = gitWorktreeSummaryHtml(data);
      showGitWorktreeButton();
    };
    let _gitDetailChrome = null;
    const applyGitDetailChrome = ({ rowHtml = "", subject = "Git" } = {}) => {
      const titleEl = gitSheetTitleEl();
      if (titleEl) {
        const subjectEl = document.createElement("span");
        subjectEl.className = "git-sheet-detail-subject";
        subjectEl.textContent = subject;
        const template = document.createElement("template");
        template.innerHTML = rowHtml.trim();
        const countsEl = template.content.querySelector(".git-summary-counts");
        titleEl.classList.add("git-sheet-detail-title", "git-sheet-title");
        titleEl.replaceChildren(subjectEl);
        if (countsEl) {
          const [ins, dels] = [...countsEl.querySelectorAll(".git-summary-count")].map((el) => el.dataset.countValue);
          titleEl.insertAdjacentHTML("beforeend", gitCountsHtml(ins, dels));
        }
        titleEl.title = subject;
      }
      hideGitWorktreeButton();
      gitPinButton.hidden = gitPanel.detailContext?.kind !== "worktree";
      setSharedSheetLeading(
        () => gitPanel.closeDetail({ refreshList: gitPanel.detailNeedsRefresh }),
        "Back to commits",
        mobileSheetBackIcon,
      );
    };
    const renderGitCommitInfo = async (hash) => {
      const info = await gitCommitInfo(hash);
      const bodyEl = gitHostEl()?.querySelector(".git-commit-detail-body");
      if (!bodyEl || gitPanel.detailContext?.hash !== hash) return;
      const trailers = [];
      const body = info.message.split("\n").slice(1).filter((line) => {
        const isTrailer = /^co-authored-by:/i.test(line);
        if (isTrailer) trailers.push(line.trim());
        return !isTrailer;
      }).join("\n").trim();
      const blockEl = document.createElement("div");
      blockEl.className = "git-commit-info-block";
      if (body) {
        const messageEl = document.createElement("div");
        messageEl.className = "git-commit-info-message";
        for (const paragraph of body.split(/\n{2,}/)) {
          const paragraphEl = document.createElement("div");
          paragraphEl.textContent = paragraph;
          messageEl.append(paragraphEl);
        }
        blockEl.append(messageEl);
      }
      const metaEl = document.createElement("div");
      metaEl.className = "git-commit-info-meta";
      metaEl.append(...[[info.hash.slice(0, 7), info.author, new Date(info.date).toLocaleString()].join(" · "), ...trailers].map((text) => {
        const lineEl = document.createElement("div");
        lineEl.textContent = text;
        return lineEl;
      }));
      blockEl.append(metaEl);
      bodyEl.querySelector(".git-commit-info-block")?.remove();
      const wrapEl = bodyEl.querySelector(".git-commit-file-wrap");
      if (wrapEl) bodyEl.insertBefore(blockEl, wrapEl);
      else bodyEl.prepend(blockEl);
    };
    const ensureGitDetailChangedTitle = (wrapEl) => {
      if (!wrapEl || wrapEl.querySelector(":scope > .git-commit-file-section-title")) return;
      const titleEl = document.createElement("div");
      titleEl.className = "git-commit-file-section-title";
      const count = wrapEl.querySelectorAll(".git-commit-file-row").length;
      titleEl.textContent = `${count} file${count === 1 ? "" : "s"} changed`;
      wrapEl.prepend(titleEl);
    };
    let gitDiffsExpanded = false;
    const gitDiffToggle = document.createElement("button");
    gitDiffToggle.type = "button";
    gitDiffToggle.className = "git-diff-toggle mobile-bottom-sheet-button";
    gitDiffToggle.hidden = true;
    gitDiffToggle.setAttribute("aria-label", "Show diffs");
    gitDiffToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5v11M6 9h12"></path><path d="M6 19.5h12"></path></svg>';
    sharedSheetFooter.appendChild(gitDiffToggle);
    const gitDiffLinesHtml = (text) => {
      const out = [];
      let inHunk = false;
      for (const line of String(text || "").replace(/\n$/, "").split("\n")) {
        if (line.startsWith("diff --git ")) {
          inHunk = false;
          continue;
        }
        if (line.startsWith("@@")) {
          inHunk = true;
          out.push(`<div class="git-diff-line is-hunk">${escapeHtml(line)}</div>`);
          continue;
        }
        if (!inHunk) {
          if (line.startsWith("Binary files")) out.push(`<div class="git-diff-line is-hunk">${escapeHtml(line)}</div>`);
          continue;
        }
        if (line.startsWith("\\")) continue;
        const kind = line.startsWith("+") ? " is-add" : line.startsWith("-") ? " is-del" : "";
        out.push(`<div class="git-diff-line${kind}">${escapeHtml(line) || "<br>"}</div>`);
      }
      return out.length ? `<div class="git-diff-scroll">${out.join("")}</div>` : '<div class="git-diff-line is-hunk">No textual changes</div>';
    };
    const renderGitFileDiffs = () => {
      const context = gitPanel.detailContext;
      if (!gitDiffsExpanded || !context?.wrapEl) return;
      context.wrapEl.querySelectorAll(".git-commit-file-row").forEach((row) => {
        if (row.nextElementSibling?.classList.contains("git-file-diff")) return;
        const block = document.createElement("div");
        block.className = "git-file-diff";
        row.after(block);
        const params = new URLSearchParams({ path: row.dataset.path || "", hash: context.hash || "" });
        if (row.dataset.oldPath) params.set("old_path", row.dataset.oldPath);
        if (row.dataset.untracked === "1") params.set("untracked", "1");
        fetchGitJson(`/git-file-diff?${params.toString()}`)
          .then((data) => { block.innerHTML = gitDiffLinesHtml(data?.diff); })
          .catch((err) => { block.innerHTML = `<div class="git-diff-line is-hunk">${escapeHtml(err?.message || String(err))}</div>`; });
      });
    };
    const syncGitDiffToggle = () => {
      gitDiffToggle.hidden = !gitPanel.detailContext;
      gitDiffToggle.classList.toggle("is-active", gitDiffsExpanded);
      gitDiffToggle.setAttribute("aria-pressed", gitDiffsExpanded ? "true" : "false");
      mobileSheet?.classList.toggle("git-diffs-expanded", gitDiffsExpanded);
    };
    const collapseWorktreeDiffs = () => {
      const context = gitPanel.detailContext;
      if (!gitDiffsExpanded || !context || context.kind === "commit") return;
      context.wrapEl?.querySelectorAll(".git-file-diff").forEach((block) => block.remove());
      gitDiffsExpanded = false;
      syncGitDiffToggle();
    };
    gitDiffToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      gitDiffsExpanded = !gitDiffsExpanded;
      syncGitDiffToggle();
      renderGitFileDiffs();
    });
    const setGitDetailChrome = ({ rowHtml = "", subject = "Git", hash = "", isWorktree = false } = {}) => {
      _gitDetailChrome = { rowHtml, subject };
      applyGitDetailChrome(_gitDetailChrome);
      syncGitDiffToggle();
      if (isWorktree || !hash) return;
      void renderGitCommitInfo(hash);
    };
    const refreshGitDetailTitleFromOverview = (data) => {
      if (!_gitDetailChrome || gitPanel.detailContext?.kind === "commit") return;
      const titleEl = gitSheetTitleEl();
      if (!titleEl?.classList.contains("git-sheet-detail-title")) return;
      const previous = gitCountSnapshot(titleEl);
      const changedPaths = Math.max(0, parseInt(data?.worktree_changed_paths) || 0);
      const subject = changedPaths ? "Uncommitted changes" : "Working tree clean";
      _gitDetailChrome = { rowHtml: gitSummaryRowHtml(data || {}), subject };
      applyGitDetailChrome(_gitDetailChrome);
      animateGitCountsFromSnapshot(titleEl, previous);
    };
    const resetGitDetailChrome = ({ hadDetail = false } = {}) => {
      _gitDetailChrome = null;
      syncGitDiffToggle();
      setGitSheetTitle();
      setSharedSheetLeading(null);
      showGitWorktreeButton();
      if (hadDetail) {
        animateGitSheetList(".git-list-view", "back");
        const list = gitHostEl()?.querySelector(".git-list-view");
        if (list) {
          pinSheetListBody(list);
          requestAnimationFrame(() => pinSheetListBody(list));
        }
      }
    };
    const restoreGitChromeAfterPreview = () => {
      if (_gitDetailChrome) applyGitDetailChrome(_gitDetailChrome);
      else {
        setGitSheetTitle();
        setSharedSheetLeading(null);
        showGitWorktreeButton();
      }
    };
    const setGitPanelBodyHtml = (html) => {
      ensureSheetDom();
      const host = gitHostEl();
      if (!host) return;
      host.innerHTML = html;
      const statusList = host.querySelector(":scope > .mobile-sheet-list.is-sheet-status");
      if (!statusList) return;
      const pin = () => {
        pinSheetListBody(statusList);
        statusList.scrollTop = 0;
      };
      pin();
      requestAnimationFrame(pin);
    };
    const gitSheetListEl = () => gitHostEl()?.querySelector(
      gitPanel.detailContext ? ".git-detail-view" : ".git-list-view"
    ) || gitHostEl();
    const gitPanel = createGitPanelController({
      root: () => gitHostEl(),
      modeEl: () => gitHostEl()?.querySelector(".git-stack") || gitHostEl(),
      observerRoot: gitSheetListEl,
      scrollRoot: gitSheetListEl,
      pinListScroll: resetSheetListScroll,
      holdDetailFilesUntilReady: true,
      canLoad: () => !!mobileSheet,
      canRefresh: () => !!mobileSheet,
      renderShell: (data) => {
        syncGitSheetBranch(data);
        renderGitWorktreeButton(data);
        setGitPanelBodyHtml(`
        <div class="git-stack mobile-sheet-stack">
          <div class="git-list-view mobile-sheet-view mobile-sheet-list">
            <div class="mobile-sheet-list-body">
              <div class="git-commit-list"></div>
              <button type="button" class="page-menu-item git-load-more" hidden></button>
            </div>
          </div>
          <div class="git-detail-view mobile-sheet-view mobile-sheet-list">
            <div class="git-commit-detail-body mobile-sheet-list-body"></div>
          </div>
        </div>`);
      },
      setBodyHtml: setGitPanelBodyHtml,
      loadingHtml: mobileSheetStatusListHtml("", { loading: true }),
      errorHtml: (message) => mobileSheetStatusListHtml(message, { error: true }),
      emptyCommitsHtml: '<div class="sheet-list-empty" data-git-empty="1">No commits</div>',
      loadMoreRetryText: "Retry loading commits",
      onLoadReset: () => {
        setGitSheetTitle();
        hideGitWorktreeButton();
      },
      onCloseDetail: resetGitDetailChrome,
      onOpenDetail: setGitDetailChrome,
      onDetailFilesReady: ({ wrapEl, isWorktree }) => {
        if (!isWorktree) ensureGitDetailChangedTitle(wrapEl);
        revealFilesFromTop(wrapEl);
        renderGitFileDiffs();
      },
      onOverview: (data) => {
        syncGitSheetBranch(data);
        refreshGitDetailTitleFromOverview(data);
      },
      onFingerprintChanged: (data) => {
        collapseWorktreeDiffs();
        const previous = gitCountSnapshot(gitWorktreeButton());
        renderGitWorktreeButton(data || {});
        animateGitCountsFromSnapshot(gitWorktreeButton(), previous);
        if (gitPinned()) renderGitPinHud(data || {}, { animate: false });
      },
    });
    document.addEventListener("git-tree-changed", () => {
      if (gitPanel.hasShell()) void gitPanel.loadPage({ reset: true });
      void refreshGitPinHud();
    });
    const updateGitPanel = async () => {
      if (!mobileSheet) return;
      if (gitPanel.hasShell()) {
        try {
          await gitPanel.refresh();
        } catch (_) { }
        return;
      }
      await gitPanel.loadPage({ reset: true });
    };
    mobileSheet?.addEventListener("click", (event) => {
      void gitPanel.handleClick(event, {
        onFileRow: async (fileRow) => {
          const path = String(fileRow.dataset.path || "").trim();
          if (!path) return;
          await openSheetPreview(gitTreePath(path), extFromPath(path), { kind: "git" });
        },
      });
    });
