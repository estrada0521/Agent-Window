__INCLUDE:../../list-flip.js__
__INCLUDE:../git-panel-html.js__
__INCLUDE:../git-panel-data.js__
__INCLUDE:../git-panel-controller.js__
    const gitSheetTitleEl = () =>
      chromeBelongsTo(mobileSheet) && sheetKind() === "git" ? sharedSheetTitleEl : null;
    let gitSheetBranch = "";
    const setGitSheetTitle = () => {
      const titleEl = gitSheetTitleEl();
      if (!titleEl) return;
      titleEl.classList.remove("git-sheet-detail-title", "git-sheet-title");
      titleEl.textContent = gitTreeLabel(gitSheetBranch) || "Git";
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
    const gitWorktreeButton = () => mobileSheet.querySelector(".git-worktree-button");
    const gitMoreButton = document.createElement("button");
    gitMoreButton.type = "button";
    gitMoreButton.className = "git-more-button mobile-bottom-sheet-button";
    gitMoreButton.hidden = true;
    gitMoreButton.setAttribute("aria-label", "Menu");
    gitMoreButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="18.5" cy="12" r="1.6"></circle></svg>';
    gitMoreButton.addEventListener("click", () => {
      openSubMenu(
        "Menu",
        [
          ["follow", `${gitFollow() ? "✓ " : ""}Follow changes`],
          ["pin", `${gitPinned() ? "✓ " : ""}Pin changes`],
        ],
        (action) => {
          if (action === "pin") {
            localStorage.setItem(gitPinStorageKey(), gitPinned() ? "0" : "1");
            void refreshGitSummaryHud();
          } else if (action === "follow") {
            setGitFollow(!gitFollow());
          }
        },
        gitMoreButton,
      );
    });
    const gitTreeButton = document.createElement("button");
    gitTreeButton.type = "button";
    gitTreeButton.className = "git-tree-switch mobile-bottom-sheet-button";
    gitTreeButton.setAttribute("aria-label", "Repository / Worktree");
    gitTreeButton.innerHTML = GIT_WORKTREE_SVG;
    const gitTreeMenu = document.createElement("select");
    gitTreeMenu.className = "hub-native-menu-select is-ios-active";
    gitTreeMenu.setAttribute("aria-label", "Repository / Worktree");
    gitTreeMenu.innerHTML = '<option value="" disabled selected>Git</option><option value="repository">Repository</option><option value="worktree">Worktree</option>';
    document.body.append(gitTreeMenu);
    gitTreeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetSubMenu({ clearOptions: true });
      gitTreeMenu.value = "";
      const rect = gitTreeButton.getBoundingClientRect();
      Object.assign(gitTreeMenu.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      openNativeSelect(gitTreeMenu);
    });
    gitTreeMenu.addEventListener("change", () => {
      const action = gitTreeMenu.value;
      gitTreeMenu.value = "";
      _ignoreGlobalClick = true;
      if (action === "repository") {
        const repositories = gitRepositories;
        openSubMenu("Repository", repositories.map((repo, index) => [String(index), `${repo.path === gitRepository() ? "✓ " : ""}${repo.path || "Root"}`]), (index) => setGitRepository(repositories[Number(index)].path), gitTreeButton);
      } else if (action === "worktree") {
        const trees = gitAllWorktrees.filter((tree) => tree.repo === gitRepository());
        openSubMenu("Worktree", trees.map((tree, index) => [String(index), `${tree.path === gitTree() ? "✓ " : ""}${tree.branch}`]), (index) => setGitTree(trees[Number(index)].path), gitTreeButton);
      }
    });
    document.addEventListener("git-worktrees-changed", () => {
      if (!gitAllWorktrees.some((tree) => tree.path === gitTree()) && openMobileSheetKind() === "git") closeSheet();
      refreshGitSheetTitle();
    });
    const gitSummaryHud = document.createElement("button");
    gitSummaryHud.type = "button";
    gitSummaryHud.className = "git-worktree-button";
    gitSummaryHud.setAttribute("aria-label", "Open uncommitted changes");
    const gitPinStorageKey = () => `agent_window_mobile_git_summary_pinned:${currentTimelineName}`;
    const gitPinned = () => localStorage.getItem(gitPinStorageKey()) === "1";
    const showGitWorktreeButton = () => {
      const btn = gitWorktreeButton();
      if (btn) btn.hidden = gitTreeButton.hidden = gitMoreButton.hidden = !!gitPanel.detailContext;
    };
    const hideGitWorktreeButton = () => {
      const btn = gitWorktreeButton();
      if (btn) btn.hidden = gitTreeButton.hidden = gitMoreButton.hidden = true;
    };
    const gitWorktreeSummaryHtml = (data) => {
      const changedPaths = data.worktree_changed_paths;
      return `<span class="git-worktree-button-label">${changedPaths ? gitPathCountText(changedPaths) : "No changes"}</span>${gitCountsHtml(data.worktree_added, data.worktree_deleted)}`;
    };
    const renderGitSummaryHud = (data, { animate = true } = {}) => {
      const previous = gitCountSnapshot(gitSummaryHud);
      gitSummaryHud.innerHTML = gitWorktreeSummaryHtml(data);
      if (animate) animateGitCountsFromSnapshot(gitSummaryHud, previous);
    };
    let gitSummaryHudShown = "";
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
        if (gitPinned()) return;
        const shown = `${currentTimelineName}\n${tree}\n${gitWorktreeCountsKey(data)}`;
        if (shown === gitSummaryHudShown) return;
        gitSummaryHudShown = shown;
        setStatus(gitSummaryHud);
      } catch (err) {
        setError("Git unavailable", err);
      }
    };
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
        const sheetPanel = mobileSheet.querySelector(".mobile-bottom-sheet-panel");
        if (!sheetPanel) return;
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "git-worktree-button mobile-bottom-sheet-button";
        sheetPanel.append(btn, gitTreeButton, gitMoreButton);
      }
      const hasDiff = data.worktree_has_diff;
      btn.disabled = !hasDiff;
      btn.classList.toggle("clickable", hasDiff);
      if (hasDiff) btn.dataset.diffKind = "worktree";
      else delete btn.dataset.diffKind;
      btn.setAttribute("aria-label", hasDiff ? "Open uncommitted changes" : "No changes");
      btn.innerHTML = gitWorktreeSummaryHtml(data);
      showGitWorktreeButton();
    };
    let _gitDetailChrome = null;
    const applyGitDetailChrome = ({ rowHtml = "", subject = "Git" } = {}) => {
      const titleEl = gitSheetTitleEl();
      if (!titleEl) return;
      const subjectEl = document.createElement("span");
      subjectEl.className = "git-sheet-detail-subject";
      subjectEl.textContent = subject;
      const template = document.createElement("template");
      template.innerHTML = rowHtml.trim();
      const countsEl = template.content.querySelector(".git-summary-counts");
      titleEl.classList.add("git-sheet-detail-title", "git-sheet-title");
      titleEl.replaceChildren(subjectEl);
      if (countsEl) {
        const [ins, dels] = [...countsEl.querySelectorAll(".git-summary-count")].map((el) => Number(el.dataset.countValue));
        titleEl.insertAdjacentHTML("beforeend", gitCountsHtml(ins, dels));
      }
      titleEl.title = subject;
      hideGitWorktreeButton();
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
      let oldLine = 0;
      let newLine = 0;
      for (const line of String(text || "").replace(/\n$/, "").split("\n")) {
        if (line.startsWith("diff --git ")) {
          inHunk = false;
          continue;
        }
        if (line.startsWith("@@")) {
          const ranges = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          oldLine = Number(ranges[1]);
          newLine = Number(ranges[2]);
          inHunk = true;
          out.push(`<tr class="git-diff-line is-hunk"><td colspan="4">${escapeHtml(line)}</td></tr>`);
          continue;
        }
        if (!inHunk) {
          if (line.startsWith("Binary files")) out.push(`<tr class="git-diff-line is-hunk"><td colspan="4">${escapeHtml(line)}</td></tr>`);
          continue;
        }
        if (line.startsWith("\\")) continue;
        const added = line.startsWith("+");
        const deleted = line.startsWith("-");
        const kind = added ? " is-add" : deleted ? " is-del" : "";
        out.push(`<tr class="git-diff-line${kind}"><td class="git-diff-number">${added ? "" : oldLine}</td><td class="git-diff-number">${deleted ? "" : newLine}</td><td>${escapeHtml(line.slice(0, 1))}</td><td class="git-diff-code">${escapeHtml(line.slice(1))}</td></tr>`);
        if (!added) oldLine += 1;
        if (!deleted) newLine += 1;
      }
      return out.length ? `<div class="git-diff-scroll"><table class="git-diff-lines"><tbody>${out.join("")}</tbody></table></div>` : '<div class="git-diff-line is-hunk">No textual changes</div>';
    };
    const GIT_DIFF_LINE_LIMIT = 10000;
    let gitDiffRequest = null;
    const canExpandGitDiffs = (rows) => {
      const lines = rows.flatMap((row) => gitCountSnapshot(row)).reduce((sum, count) => sum + count, 0);
      if (lines < GIT_DIFF_LINE_LIMIT) return true;
      setError("Diff too large");
      return false;
    };
    const fetchGitFileDiff = async (row, context, signal) => {
      const scope = row.closest(".git-commit-file-section")?.dataset.scope || context.kind;
      const params = new URLSearchParams({ path: row.dataset.path, hash: context.hash, scope });
      if (row.dataset.oldPath) params.set("old_path", row.dataset.oldPath);
      if (row.dataset.untracked === "1") params.set("untracked", "1");
      const data = await fetchGitJson(`/git-file-diff?${params}`, { signal });
      const block = document.createElement("div");
      block.className = "git-file-diff";
      block.innerHTML = gitDiffLinesHtml(data.diff);
      return block;
    };
    const renderGitFileDiffs = async () => {
      const context = gitPanel.detailContext;
      if (!gitDiffsExpanded || !context?.wrapEl) return;
      const rows = [...context.wrapEl.querySelectorAll(".git-commit-file-row")]
        .filter((row) => !row.nextElementSibling?.classList.contains("git-file-diff"));
      if (!rows.length) {
        syncGitDiffToggle();
        return;
      }
      if (!canExpandGitDiffs(rows)) {
        gitDiffsExpanded = false;
        syncGitDiffToggle();
        return;
      }
      syncGitDiffToggle();
      gitDiffRequest?.abort();
      const request = new AbortController();
      gitDiffRequest = request;
      gitDiffToggle.disabled = true;
      try {
        await Promise.all(rows.map(async (row) => {
          const block = await fetchGitFileDiff(row, context, request.signal);
          if (gitPanel.detailContext !== context || request.signal.aborted) return;
          if (!row.nextElementSibling?.classList.contains("git-file-diff")) row.after(block);
        }));
      } catch (err) {
        if (gitPanel.detailContext !== context || request.signal.aborted) return;
        request.abort();
        gitDiffsExpanded = false;
        syncGitDiffToggle();
        setError("Failed to load diff", err);
      } finally {
        if (gitDiffRequest === request) {
          gitDiffRequest = null;
          gitDiffToggle.disabled = false;
        }
      }
    };
    const toggleGitFileDiff = async (row) => {
      const context = gitPanel.detailContext;
      if (!context || row._gitDiffRequest || gitDiffRequest) return;
      const existing = row.nextElementSibling;
      if (existing?.classList.contains("git-file-diff")) {
        existing.remove();
        return;
      }
      if (!canExpandGitDiffs([row])) return;
      const request = new AbortController();
      row._gitDiffRequest = request;
      try {
        const block = await fetchGitFileDiff(row, context, request.signal);
        if (!request.signal.aborted && gitPanel.detailContext === context && row.isConnected && !row.nextElementSibling?.classList.contains("git-file-diff")) {
          row.after(block);
        }
      } catch (err) {
        if (!request.signal.aborted && gitPanel.detailContext === context && row.isConnected) setError("Failed to load diff", err);
      } finally {
        if (row._gitDiffRequest === request) delete row._gitDiffRequest;
      }
    };
    const syncGitDiffToggle = () => {
      gitDiffToggle.hidden = !gitPanel.detailContext;
      gitDiffToggle.classList.toggle("is-active", gitDiffsExpanded);
      gitDiffToggle.setAttribute("aria-pressed", gitDiffsExpanded ? "true" : "false");
    };
    const removeGitFileDiffs = () => {
      gitDiffRequest?.abort();
      gitPanel.detailContext?.wrapEl.querySelectorAll(".git-commit-file-row").forEach((row) => {
        row._gitDiffRequest?.abort();
        if (row.nextElementSibling?.classList.contains("git-file-diff")) row.nextElementSibling.remove();
      });
    };
    const collapseWorktreeDiffs = () => {
      const context = gitPanel.detailContext;
      if (!context || context.kind === "commit") return;
      removeGitFileDiffs();
      gitDiffsExpanded = false;
      syncGitDiffToggle();
    };
    gitDiffToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      gitDiffsExpanded = !gitDiffsExpanded;
      if (gitDiffsExpanded) void renderGitFileDiffs();
      else {
        removeGitFileDiffs();
        syncGitDiffToggle();
      }
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
      const subject = data.worktree_changed_paths ? "Uncommitted changes" : "No changes";
      _gitDetailChrome = { rowHtml: gitSummaryRowHtml(data), subject };
      applyGitDetailChrome(_gitDetailChrome);
      animateGitCountsFromSnapshot(titleEl, previous);
    };
    const resetGitDetailChrome = ({ hadDetail = false } = {}) => {
      _gitDetailChrome = null;
      gitDiffRequest?.abort();
      gitDiffsExpanded = false;
      syncGitDiffToggle();
      if (gitSheetTitleEl()) {
        setGitSheetTitle();
        setSharedSheetLeading(null);
      }
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
      renderShell: (data) => {
        syncGitSheetBranch(data);
        renderGitWorktreeButton(data);
        setGitPanelBodyHtml(`
        <div class="git-stack mobile-sheet-stack">
          <div class="git-list-view mobile-sheet-view mobile-sheet-list">
            <div class="mobile-sheet-list-body">
              <div class="git-commit-list"></div>
            </div>
          </div>
          <div class="git-detail-view mobile-sheet-view mobile-sheet-list">
            <div class="git-commit-detail-body mobile-sheet-list-body"></div>
          </div>
        </div>`);
      },
      setBodyHtml: setGitPanelBodyHtml,
      loadingHtml: mobileSheetStatusListHtml("", { loading: true }),
      onError: (error) => setError("Git unavailable", error),
      emptyCommitsHtml: '<div class="sheet-list-empty" data-git-empty="1">No commits</div>',
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
        renderGitWorktreeButton(data);
        animateGitCountsFromSnapshot(gitWorktreeButton(), previous);
        if (gitPinned()) renderGitSummaryHud(data, { animate: false });
      },
    });
    document.addEventListener("git-tree-changed", () => {
      if (!gitAllWorktrees.some((tree) => tree.path === gitTree())) {
        if (openMobileSheetKind() === "git") closeSheet();
        setBackgroundStatus(null);
        return;
      }
      if (gitPanel.hasShell()) void gitPanel.loadPage({ reset: true });
      void refreshGitSummaryHud();
    });
    const updateGitPanel = async () => {
      if (gitPanel.hasShell()) {
        await gitPanel.refresh();
        return;
      }
      await gitPanel.loadPage({ reset: true });
    };
    const gitFileMenu = document.createElement("select");
    gitFileMenu.className = "hub-native-menu-select is-ios-active";
    gitFileMenu.setAttribute("aria-label", "File actions");
    document.body.append(gitFileMenu);
    let gitFilePress = null;
    let gitMenuPath = "";
    mobileSheet.addEventListener("touchstart", (event) => {
      const row = event.target.closest(".git-commit-file-row");
      const touch = event.touches[0];
      gitFilePress = row && event.touches.length === 1
        ? { row, x: touch.clientX, y: touch.clientY, started: performance.now() } : null;
    }, { passive: true });
    mobileSheet.addEventListener("touchmove", (event) => {
      const touch = event.touches[0];
      if (gitFilePress && (!touch || Math.hypot(touch.clientX - gitFilePress.x, touch.clientY - gitFilePress.y) > 10)) gitFilePress = null;
    }, { passive: true });
    mobileSheet.addEventListener("touchcancel", () => { gitFilePress = null; }, { passive: true });
    mobileSheet.addEventListener("contextmenu", (event) => {
      if (event.target.closest(".git-commit-file-row")) event.preventDefault();
    });
    mobileSheet.addEventListener("touchend", (event) => {
      const press = gitFilePress;
      gitFilePress = null;
      if (!press || performance.now() - press.started < 450) return;
      event.preventDefault();
      event.stopPropagation();
      gitMenuPath = gitTreePath(press.row.dataset.path);
      gitFileMenu.innerHTML = '<option value="" disabled selected>File</option><option value="open">Open File</option>';
      const rect = press.row.getBoundingClientRect();
      Object.assign(gitFileMenu.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      openNativeSelect(gitFileMenu);
    }, { passive: false });
    gitFileMenu.addEventListener("change", () => {
      if (gitFileMenu.value === "open") void openSheetPreview(gitMenuPath, extFromPath(gitMenuPath), { kind: "git" });
      gitFileMenu.value = "";
    });
    mobileSheet.addEventListener("click", (event) => {
      void gitPanel.handleClick(event, {
        onFileRow: toggleGitFileDiff,
      });
    });
