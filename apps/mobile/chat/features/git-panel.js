__CHAT_INCLUDE:../../../shared/chat/git-panel-html.js__
__CHAT_INCLUDE:../../../shared/chat/git-panel-data.js__
    let gitBranchCommits = [];
    let gitBranchNextOffset = 0;
    let gitBranchTotalCommits = 0;
    let gitBranchHasMore = false;
    let gitBranchPageLoading = false;
    let gitBranchLoadError = "";
    let gitBranchLoadSeq = 0;
    let gitBranchRefreshSeq = 0;
    let gitBranchOverviewSig = "";
    let gitBranchDetailContext = null;
    let gitBranchDetailNeedsRefresh = false;
    let gitBranchObserver = null;
    const disconnectGitBranchObserver = () => {
      if (!gitBranchObserver) return;
      try { gitBranchObserver.disconnect(); } catch (_) { }
      gitBranchObserver = null;
    };
    const gitBranchCommitListEl = () => gitBranchPanel?.querySelector(".git-branch-commit-list");
    const gitBranchLoadMoreEl = () => gitBranchPanel?.querySelector(".git-branch-load-more");
    const gitBranchScrollRootEl = () => gitBranchPanel?.querySelector(".git-branch-sheet-content") || gitBranchPanel;
    const gitBranchSheetTitleEl = () => gitBranchPanel?.querySelector(".git-branch-sheet-title");
    const setGitBranchSheetTitle = () => {
      const titleEl = gitBranchSheetTitleEl();
      if (!titleEl) return;
      titleEl.textContent = "Git Branches";
      titleEl.title = "Git Branches";
    };
    const setGitBranchPanelBodyHtml = (html) => {
      const contentEl = ensureGitBranchSheetDom();
      if (contentEl) {
        contentEl.innerHTML = html;
        return;
      }
      if (gitBranchPanel) gitBranchPanel.innerHTML = html;
    };
    const renderGitBranchCommitRows = (commits, { append = false } = {}) => {
      const listEl = gitBranchCommitListEl();
      if (!listEl) return;
      if (!append) {
        if (!commits.length) {
          listEl.innerHTML = '<div class="git-commit-file-empty" data-git-branch-empty="1">No commits</div>';
          return;
        }
        listEl.innerHTML = commits.map((commit) => gitCommitRowHtml(commit)).join("");
        return;
      }
      if (!commits.length) return;
      listEl.querySelector("[data-git-branch-empty]")?.remove();
      listEl.insertAdjacentHTML("beforeend", commits.map((commit) => gitCommitRowHtml(commit)).join(""));
    };
    const updateGitBranchLoadMoreUi = () => {
      const btn = gitBranchLoadMoreEl();
      if (!btn) return;
      if (!gitBranchHasMore && !gitBranchLoadError) {
        btn.hidden = true;
        btn.disabled = true;
        btn.classList.remove("inline-loading-row");
        btn.textContent = "";
        return;
      }
      btn.hidden = false;
      btn.disabled = gitBranchPageLoading;
      if (gitBranchLoadError) {
        btn.classList.remove("inline-loading-row");
        btn.textContent = "Retry loading commits";
      } else if (gitBranchPageLoading) {
        btn.classList.add("inline-loading-row");
        btn.innerHTML = loadingIndicatorHtml("Loading…");
      } else if (gitBranchTotalCommits > 0) {
        btn.classList.remove("inline-loading-row");
        btn.textContent = `Load more commits (${gitBranchCommits.length}/${gitBranchTotalCommits})`;
      } else {
        btn.classList.remove("inline-loading-row");
        btn.textContent = "Load more commits";
      }
    };
    const ensureGitBranchObserver = () => {
      disconnectGitBranchObserver();
      const btn = gitBranchLoadMoreEl();
      if (!btn || !gitBranchHasMore || gitBranchPageLoading || gitBranchLoadError || typeof IntersectionObserver !== "function") return;
      gitBranchObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          void loadGitBranchOverviewPage();
        });
      }, {
        root: gitBranchScrollRootEl(),
        rootMargin: "220px 0px 220px 0px",
        threshold: 0.01,
      });
      gitBranchObserver.observe(btn);
    };
    const renderGitBranchPanelShell = (data) => {
      setGitBranchPanelBodyHtml(`
        <div class="git-branch-stack">
          <div class="git-branch-list-view">
            <div class="git-branch-summary-wrap">${gitBranchSummaryRowHtml(data)}</div>
            <div class="git-branch-commit-list"></div>
            <button type="button" class="page-menu-item git-branch-load-more" hidden></button>
          </div>
          <div class="git-branch-detail-view">
            <button type="button" class="git-commit-detail-head" aria-label="コミット一覧に戻る"></button>
            <div class="git-commit-detail-body"></div>
          </div>
        </div>`);
    };
    const applyGitBranchOverviewPaging = (page, { reset = false } = {}) => {
      gitBranchCommits = page.commits;
      gitBranchTotalCommits = page.totalCommits;
      gitBranchNextOffset = page.nextOffset;
      gitBranchHasMore = page.hasMore;
      if (reset) gitBranchOverviewSig = page.fingerprint;
      if (reset) {
        renderGitBranchCommitRows(gitBranchCommits, { append: false });
      } else if (page.pageCommits.length) {
        renderGitBranchCommitRows(page.pageCommits, { append: true });
      }
      updateGitBranchLoadMoreUi();
      ensureGitBranchObserver();
    };
    const applyGitBranchOverviewPage = (data, { reset = false } = {}) => {
      if (reset) renderGitBranchPanelShell(data || {});
      applyGitBranchOverviewPaging(gitOverviewPagingFromResponse(data, gitBranchCommits, { reset }), { reset });
    };
    const refreshGitBranchOverviewView = async () => {
      if (!gitBranchPanel) return;
      const refreshSeq = ++gitBranchRefreshSeq;
      const data = await fetchGitBranchOverview({ offset: 0, refresh: true });
      if (refreshSeq !== gitBranchRefreshSeq) return;
      const nextOverviewSig = gitOverviewFingerprint(data);
      if (nextOverviewSig !== gitBranchOverviewSig) {
        const summaryWrap = gitBranchPanel.querySelector(".git-branch-summary-wrap");
        if (summaryWrap) {
          const previous = gitBranchCountSnapshot(summaryWrap);
          summaryWrap.innerHTML = gitBranchSummaryRowHtml(data || {});
          animateGitBranchCountsFromSnapshot(summaryWrap, previous);
        }
        applyGitBranchOverviewPaging(gitOverviewPagingFromResponse(data, [], { reset: true }), { reset: true });
      }
      if (gitBranchDetailContext?.kind === "worktree" && gitBranchDetailContext?.wrapEl) {
        await renderGitCommitFileStatsInto(gitBranchDetailContext.wrapEl, "", {
          allowUndo: true,
          preserveCurrent: true,
        });
      }
    };
    const renderGitCommitFileStatsInto = async (
      wrapEl,
      hash,
      { allowUndo = false, scope = "", preserveCurrent = false } = {},
    ) => {
      if (!wrapEl) return null;
      const requestSeq = Math.max(0, parseInt(wrapEl.dataset.fileStatsRequestSeq) || 0) + 1;
      wrapEl.dataset.fileStatsRequestSeq = String(requestSeq);
      if (!preserveCurrent) {
        delete wrapEl.dataset.fileStatsSignature;
        wrapEl.innerHTML = `<div class="git-commit-file-empty inline-loading-row">${loadingIndicatorHtml("Loading…")}</div>`;
      }
      const loaded = await loadGitDiffFileStats({ hash, scope });
      if (String(requestSeq) !== wrapEl.dataset.fileStatsRequestSeq) return null;
      if (loaded.mode === "sections") {
        const signature = gitFileStatsRowsSignature(loaded.sections);
        if (preserveCurrent && wrapEl.dataset.fileStatsSignature === signature) {
          return { files: loaded.files };
        }
        wrapEl.dataset.fileStatsSignature = signature;
        if (!loaded.sections.length) {
          wrapEl.innerHTML = '<div class="git-commit-file-empty">No changed files</div>';
          return { files: [] };
        }
        wrapEl.innerHTML = gitCommitFileStatsSectionsHtml(loaded.sections, { allowUndo });
        return { files: loaded.files };
      }
      const signature = gitFileStatsRowsSignature([{ kind: scope || "commit", files: loaded.files }]);
      if (preserveCurrent && wrapEl.dataset.fileStatsSignature === signature) return loaded.data;
      wrapEl.dataset.fileStatsSignature = signature;
      if (!loaded.files.length) {
        wrapEl.innerHTML = '<div class="git-commit-file-empty">No changed files</div>';
        return loaded.data;
      }
      wrapEl.innerHTML = gitCommitFileListHtml(loaded.files, { allowUndo, scope });
      return loaded.data;
    };
    const closeGitBranchInlineDiff = ({ refreshList = false } = {}) => {
      if (!gitBranchPanel) return;
      gitBranchPanel.classList.remove("git-branch-transitioning");
      gitBranchPanel.classList.remove("git-branch-mode-detail");
      setGitBranchSheetTitle("Git Branches");
      const body = gitBranchPanel.querySelector(".git-commit-detail-body");
      if (body) body.innerHTML = "";
      const head = gitBranchPanel.querySelector(".git-commit-detail-head");
      if (head) head.innerHTML = "";
      gitBranchDetailContext = null;
      updateGitBranchLoadMoreUi();
      ensureGitBranchObserver();
      const shouldRefresh = !!refreshList;
      gitBranchDetailNeedsRefresh = false;
      if (shouldRefresh) {
        void loadGitBranchOverviewPage({ reset: true });
      }
    };
    const loadGitBranchOverviewPage = async ({ reset = false } = {}) => {
      if (!gitBranchPanel) return;
      if (gitBranchPageLoading) return;
      if (!reset && !gitBranchHasMore && !gitBranchLoadError) return;
      const loadSeq = ++gitBranchLoadSeq;
      gitBranchPageLoading = true;
      gitBranchLoadError = "";
      disconnectGitBranchObserver();
      if (reset) {
        gitBranchRefreshSeq += 1;
        closeGitBranchInlineDiff();
        setGitBranchSheetTitle("Git Branches");
        gitBranchHasMore = false;
        gitBranchNextOffset = 0;
        gitBranchTotalCommits = 0;
        gitBranchCommits = [];
        setGitBranchPanelBodyHtml(`<div class="page-menu-item inline-loading-row" style="cursor:default">${loadingIndicatorHtml("Loading…")}</div>`);
      } else {
        updateGitBranchLoadMoreUi();
      }
      try {
        const data = await fetchGitBranchOverview({
          offset: reset ? 0 : gitBranchNextOffset,
          refresh: reset,
        });
        if (loadSeq !== gitBranchLoadSeq) return;
        applyGitBranchOverviewPage(data, { reset });
      } catch (err) {
        if (loadSeq !== gitBranchLoadSeq) return;
        if (reset) {
          setGitBranchPanelBodyHtml(`<div class="page-menu-item" style="cursor:default;opacity:0.72">${escapeHtml(err?.message || "Failed to load branch overview")}</div>`);
        } else {
          gitBranchLoadError = err?.message || "Failed to load more commits";
        }
      } finally {
        if (loadSeq !== gitBranchLoadSeq) return;
        gitBranchPageLoading = false;
        updateGitBranchLoadMoreUi();
        ensureGitBranchObserver();
      }
    };
    const updateGitBranchPanel = async () => {
      if (gitBranchPanel?.querySelector(".git-branch-stack")) {
        try {
          await refreshGitBranchOverviewView();
        } catch (_) {}
        return;
      }
      await loadGitBranchOverviewPage({ reset: true });
    };
    if (gitBranchPanel) {
      gitBranchPanel.addEventListener("click", async (e) => {
        const loadMoreBtn = e.target.closest(".git-branch-load-more");
        if (loadMoreBtn) {
          e.stopPropagation();
          e.preventDefault();
          await loadGitBranchOverviewPage();
          return;
        }
        if (e.target.closest(".git-commit-detail-head")) {
          e.stopPropagation();
          closeGitBranchInlineDiff({ refreshList: gitBranchDetailNeedsRefresh });
          return;
        }
        if (gitBranchPanel.classList.contains("git-branch-mode-detail")) return;
        const row = e.target.closest(".git-commit-row, .git-branch-summary-row");
        if (!row) return;
        const diffKind = row.dataset.diffKind || "";
        const hash = row.dataset.hash;
        if (!hash && !diffKind) return;
        e.stopPropagation();
        closeGitBranchInlineDiff();
        disconnectGitBranchObserver();
        gitBranchDetailNeedsRefresh = false;
        gitBranchPanel.classList.add("git-branch-transitioning");
        const subject = diffKind
          ? (row.querySelector(".git-branch-summary-label")?.textContent?.trim() || "Uncommitted changes")
          : (row.querySelector(".git-commit-subject")?.textContent?.trim() || hash.slice(0, 7));
        const headEl = gitBranchPanel.querySelector(".git-commit-detail-head");
        const bodyEl = gitBranchPanel.querySelector(".git-commit-detail-body");
        if (headEl) {
          headEl.title = subject;
          headEl.innerHTML = row.outerHTML;
        }
        if (!bodyEl) return;
        const wrapEl = document.createElement("div");
        wrapEl.className = "git-commit-file-wrap";
        bodyEl.appendChild(wrapEl);
        setGitBranchSheetTitle("Git Branches");
        gitBranchPanel.classList.add("git-branch-mode-detail");
        gitBranchDetailContext = {
          kind: diffKind === "worktree" ? "worktree" : "commit",
          hash: diffKind === "worktree" ? "" : String(hash || ""),
          wrapEl,
        };
        const scrollRoot = gitBranchScrollRootEl();
        if (scrollRoot) scrollRoot.scrollTop = 0;
        requestAnimationFrame(() => {
          gitBranchPanel?.classList.remove("git-branch-transitioning");
        });
        try {
          await renderGitCommitFileStatsInto(
            wrapEl,
            diffKind === "worktree" ? "" : hash,
            { allowUndo: diffKind === "worktree", scope: diffKind === "worktree" ? "" : diffKind },
          );
        } catch (err) {
          wrapEl.innerHTML = '<div class="git-commit-file-empty">Failed to load file stats</div>';
        }
      });
    }
