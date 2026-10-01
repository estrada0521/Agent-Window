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
      if (gitFollow()) {
        const dot = document.createElement("span");
        dot.className = "sheet-title-follow-dot";
        titleEl.append(dot);
      }
    };
    const refreshGitSheetTitle = () => {
      if (sheetKind() === "git" && !gitPanel.detailContext && !mobileSheet.classList.contains("sheet-mode-preview")) setGitSheetTitle();
    };
    const syncGitSheetBranch = (data) => {
      gitSheetBranch = data?.branch || "";
      refreshGitSheetTitle();
    };
    document.addEventListener("git-follow-changed", refreshGitSheetTitle);
    const gitWorktreeButton = () => mobileSheet?.querySelector(".git-worktree-button");
    const gitPinButton = document.createElement("button");
    gitPinButton.type = "button";
    gitPinButton.className = "git-summary-pin mobile-bottom-sheet-button";
    gitPinButton.hidden = true;
    gitPinButton.innerHTML = GIT_SUMMARY_PIN_SVG;
    const gitMoreButton = document.createElement("button");
    gitMoreButton.type = "button";
    gitMoreButton.className = "git-more-button mobile-bottom-sheet-button";
    gitMoreButton.hidden = true;
    gitMoreButton.setAttribute("aria-label", "Menu");
    gitMoreButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="18.5" cy="12" r="1.6"></circle></svg>';
    gitMoreButton.addEventListener("click", () => {
      openSubMenu(
        "Menu",
        [["follow", `Follow Mode: ${gitFollow() ? "On" : "Off"}`]],
        () => setGitFollow(!gitFollow()),
        gitMoreButton,
      );
    });
    let gitWorktreeList = [];
    const gitTreeButton = document.createElement("button");
    gitTreeButton.type = "button";
    gitTreeButton.className = "git-tree-switch mobile-bottom-sheet-button";
    gitTreeButton.setAttribute("aria-label", "Switch worktree");
    gitTreeButton.innerHTML = GIT_WORKTREE_SVG;
    const loadGitWorktreeList = async () => {
      gitWorktreeList = await fetchGitWorktrees();
    };
    document.addEventListener("git-worktrees-changed", async () => {
      if (openMobileSheetKind() !== "git") return;
      try {
        await loadGitWorktreeList();
      } catch (err) {
        gitWorktreeList = [];
        setStatus(err?.message || "Failed to load worktrees");
      }
    });
    gitTreeButton.addEventListener("click", () => {
      if (gitWorktreeList.length < 2) {
        setStatus("No other worktrees");
        return;
      }
      const trees = gitWorktreeList;
      openSubMenu(
        "Worktree",
        trees.map((tree, index) => [String(index), tree.branch]),
        (index) => setGitTree(trees[Number(index)].path),
        gitTreeButton,
      );
    });
    const gitSummaryHud = document.createElement("button");
    gitSummaryHud.type = "button";
    gitSummaryHud.className = "git-worktree-button";
    gitSummaryHud.setAttribute("aria-label", "Open uncommitted changes");
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
      if (btn) btn.hidden = gitTreeButton.hidden = gitMoreButton.hidden = !!gitPanel.detailContext;
      gitPinButton.hidden = true;
    };
    const hideGitWorktreeButton = () => {
      const btn = gitWorktreeButton();
      if (btn) btn.hidden = gitPinButton.hidden = gitTreeButton.hidden = gitMoreButton.hidden = true;
    };
    const gitWorktreeSummaryHtml = (data) => {
      const changedPaths = Math.max(0, parseInt(data?.worktree_changed_paths) || 0);
      const added = Math.max(0, parseInt(data?.worktree_added) || 0);
      const deleted = Math.max(0, parseInt(data?.worktree_deleted) || 0);
      return `<span class="git-worktree-button-label">${gitPathCountText(changedPaths)}</span>${gitCountsHtml(added, deleted)}`;
    };
    const renderGitSummaryHud = (data, { animate = true } = {}) => {
      const previous = gitCountSnapshot(gitSummaryHud);
      gitSummaryHud.innerHTML = gitWorktreeSummaryHtml(data);
      if (animate) animateGitCountsFromSnapshot(gitSummaryHud, previous);
    };
    const refreshGitSummaryHud = async ({ notify = false } = {}) => {
      if (!gitPinned() && !notify) {
        setBackgroundStatus(null);
        return;
      }
      try {
        const tree = gitTree();
        const data = await fetchGitOverview({ summary: true });
        if (tree !== gitTree() || (!gitPinned() && !notify)) return;
        renderGitSummaryHud(data);
        if (gitWorktreeButton()) renderGitWorktreeButton(data);
        setBackgroundStatus(gitPinned() ? gitSummaryHud : null);
        if (!gitPinned()) setStatus(gitSummaryHud);
      } catch (err) {
        setStatus(err?.message || "Failed to load Git summary");
      }
    };
    gitPinButton.addEventListener("click", () => {
      localStorage.setItem(gitPinStorageKey(), gitPinned() ? "0" : "1");
      syncGitPinButton();
      void refreshGitSummaryHud();
    });
    gitSummaryHud.addEventListener("click", async () => {
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
        sheetPanel.append(btn, gitTreeButton, gitMoreButton, gitPinButton);
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
        out.push(`<div class="git-diff-line${kind}">${escapeHtml(line.slice(0, 1))}<span class="git-diff-code">${escapeHtml(line.slice(1))}</span></div>`);
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
        block.dataset.path = row.dataset.path || "";
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
        if (gitPinned()) renderGitSummaryHud(data || {}, { animate: false });
      },
    });
    document.addEventListener("git-tree-changed", () => {
      if (gitPanel.hasShell()) void gitPanel.loadPage({ reset: true });
      void refreshGitSummaryHud();
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
