__CHAT_INCLUDE:../../../shared/chat/git-panel-html.js__
__CHAT_INCLUDE:../../../shared/chat/git-panel-data.js__
    let gitCommits = [];
    let gitNextOffset = 0;
    let gitTotalCommits = 0;
    let gitHasMore = false;
    let gitPageLoading = false;
    let gitLoadError = "";
    let gitLoadSeq = 0;
    let gitRefreshSeq = 0;
    let gitOverviewSig = "";
    let gitDetailContext = null;
    let gitDetailNeedsRefresh = false;
    let gitObserver = null;
    const disconnectGitObserver = () => {
      if (!gitObserver) return;
      try { gitObserver.disconnect(); } catch (_) { }
      gitObserver = null;
    };
    const gitCommitListEl = () => gitPanel?.querySelector(".git-commit-list");
    const gitLoadMoreEl = () => gitPanel?.querySelector(".git-load-more");
    const gitScrollRootEl = () => gitPanel?.querySelector(".git-sheet-content") || gitPanel;
    const gitSheetTitleEl = () => gitPanel?.querySelector(".git-sheet-title");
    const setGitSheetTitle = () => {
      const titleEl = gitSheetTitleEl();
      if (!titleEl) return;
      titleEl.textContent = "Git";
      titleEl.title = "Git";
    };
    const setGitPanelBodyHtml = (html) => {
      const contentEl = ensureGitSheetDom();
      if (contentEl) {
        contentEl.innerHTML = html;
        return;
      }
      if (gitPanel) gitPanel.innerHTML = html;
    };
    const renderGitCommitRows = (commits, { append = false } = {}) => {
      const listEl = gitCommitListEl();
      if (!listEl) return;
      if (!append) {
        if (!commits.length) {
          listEl.innerHTML = '<div class="git-commit-file-empty" data-git-empty="1">No commits</div>';
          return;
        }
        listEl.innerHTML = commits.map((commit) => gitCommitRowHtml(commit)).join("");
        return;
      }
      if (!commits.length) return;
      listEl.querySelector("[data-git-empty]")?.remove();
      listEl.insertAdjacentHTML("beforeend", commits.map((commit) => gitCommitRowHtml(commit)).join(""));
    };
    const updateGitLoadMoreUi = () => {
      const btn = gitLoadMoreEl();
      if (!btn) return;
      if (!gitHasMore && !gitLoadError) {
        btn.hidden = true;
        btn.disabled = true;
        btn.classList.remove("inline-loading-row");
        btn.textContent = "";
        return;
      }
      btn.hidden = false;
      btn.disabled = gitPageLoading;
      if (gitLoadError) {
        btn.classList.remove("inline-loading-row");
        btn.textContent = "Retry loading commits";
      } else if (gitPageLoading) {
        btn.classList.add("inline-loading-row");
        btn.innerHTML = loadingIndicatorHtml("Loading…");
      } else if (gitTotalCommits > 0) {
        btn.classList.remove("inline-loading-row");
        btn.textContent = `Load more commits (${gitCommits.length}/${gitTotalCommits})`;
      } else {
        btn.classList.remove("inline-loading-row");
        btn.textContent = "Load more commits";
      }
    };
    const ensureGitObserver = () => {
      disconnectGitObserver();
      const btn = gitLoadMoreEl();
      if (!btn || !gitHasMore || gitPageLoading || gitLoadError || typeof IntersectionObserver !== "function") return;
      gitObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          void loadGitOverviewPage();
        });
      }, {
        root: gitScrollRootEl(),
        rootMargin: "220px 0px 220px 0px",
        threshold: 0.01,
      });
      gitObserver.observe(btn);
    };
    const renderGitPanelShell = (data) => {
      setGitPanelBodyHtml(`
        <div class="git-stack">
          <div class="git-list-view">
            <div class="git-summary-wrap">${gitSummaryRowHtml(data)}</div>
            <div class="git-commit-list"></div>
            <button type="button" class="page-menu-item git-load-more" hidden></button>
          </div>
          <div class="git-detail-view">
            <button type="button" class="git-commit-detail-head" aria-label="コミット一覧に戻る"></button>
            <div class="git-commit-detail-body"></div>
          </div>
        </div>`);
    };
    const applyGitOverviewPaging = (page, { reset = false } = {}) => {
      gitCommits = page.commits;
      gitTotalCommits = page.totalCommits;
      gitNextOffset = page.nextOffset;
      gitHasMore = page.hasMore;
      if (reset) gitOverviewSig = page.fingerprint;
      if (reset) {
        renderGitCommitRows(gitCommits, { append: false });
      } else if (page.pageCommits.length) {
        renderGitCommitRows(page.pageCommits, { append: true });
      }
      updateGitLoadMoreUi();
      ensureGitObserver();
    };
    const applyGitOverviewPage = (data, { reset = false } = {}) => {
      if (reset) renderGitPanelShell(data || {});
      applyGitOverviewPaging(gitOverviewPagingFromResponse(data, gitCommits, { reset }), { reset });
    };
    const refreshGitOverviewView = async () => {
      if (!gitPanel) return;
      const refreshSeq = ++gitRefreshSeq;
      const data = await fetchGitOverview({ offset: 0, refresh: true });
      if (refreshSeq !== gitRefreshSeq) return;
      const nextOverviewSig = gitOverviewFingerprint(data);
      if (nextOverviewSig !== gitOverviewSig) {
        const summaryWrap = gitPanel.querySelector(".git-summary-wrap");
        if (summaryWrap) {
          const previous = gitCountSnapshot(summaryWrap);
          summaryWrap.innerHTML = gitSummaryRowHtml(data || {});
          animateGitCountsFromSnapshot(summaryWrap, previous);
        }
        applyGitOverviewPaging(gitOverviewPagingFromResponse(data, [], { reset: true }), { reset: true });
      }
      if (gitDetailContext?.kind === "worktree" && gitDetailContext?.wrapEl) {
        await renderGitCommitFileStatsInto(gitDetailContext.wrapEl, "", {
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
    const closeGitDetail = ({ refreshList = false } = {}) => {
      if (!gitPanel) return;
      gitPanel.classList.remove("git-transitioning");
      gitPanel.classList.remove("git-mode-detail");
      setGitSheetTitle("Git");
      const body = gitPanel.querySelector(".git-commit-detail-body");
      if (body) body.innerHTML = "";
      const head = gitPanel.querySelector(".git-commit-detail-head");
      if (head) head.innerHTML = "";
      gitDetailContext = null;
      updateGitLoadMoreUi();
      ensureGitObserver();
      const shouldRefresh = !!refreshList;
      gitDetailNeedsRefresh = false;
      if (shouldRefresh) {
        void loadGitOverviewPage({ reset: true });
      }
    };
    const loadGitOverviewPage = async ({ reset = false } = {}) => {
      if (!gitPanel) return;
      if (gitPageLoading) return;
      if (!reset && !gitHasMore && !gitLoadError) return;
      const loadSeq = ++gitLoadSeq;
      gitPageLoading = true;
      gitLoadError = "";
      disconnectGitObserver();
      if (reset) {
        gitRefreshSeq += 1;
        closeGitDetail();
        setGitSheetTitle("Git");
        gitHasMore = false;
        gitNextOffset = 0;
        gitTotalCommits = 0;
        gitCommits = [];
        setGitPanelBodyHtml(`<div class="page-menu-item inline-loading-row" style="cursor:default">${loadingIndicatorHtml("Loading…")}</div>`);
      } else {
        updateGitLoadMoreUi();
      }
      try {
        const data = await fetchGitOverview({
          offset: reset ? 0 : gitNextOffset,
          refresh: reset,
        });
        if (loadSeq !== gitLoadSeq) return;
        applyGitOverviewPage(data, { reset });
      } catch (err) {
        if (loadSeq !== gitLoadSeq) return;
        if (reset) {
          setGitPanelBodyHtml(`<div class="page-menu-item" style="cursor:default;opacity:0.72">${escapeHtml(err?.message || "Failed to load git overview")}</div>`);
        } else {
          gitLoadError = err?.message || "Failed to load more commits";
        }
      } finally {
        if (loadSeq !== gitLoadSeq) return;
        gitPageLoading = false;
        updateGitLoadMoreUi();
        ensureGitObserver();
      }
    };
    const updateGitPanel = async () => {
      if (gitPanel?.querySelector(".git-stack")) {
        try {
          await refreshGitOverviewView();
        } catch (_) {}
        return;
      }
      await loadGitOverviewPage({ reset: true });
    };
    if (gitPanel) {
      gitPanel.addEventListener("click", async (e) => {
        const loadMoreBtn = e.target.closest(".git-load-more");
        if (loadMoreBtn) {
          e.stopPropagation();
          e.preventDefault();
          await loadGitOverviewPage();
          return;
        }
        if (e.target.closest(".git-commit-detail-head")) {
          e.stopPropagation();
          closeGitDetail({ refreshList: gitDetailNeedsRefresh });
          return;
        }
        if (gitPanel.classList.contains("git-mode-detail")) return;
        const row = e.target.closest(".git-commit-row, .git-summary-row");
        if (!row) return;
        const diffKind = row.dataset.diffKind || "";
        const hash = row.dataset.hash;
        if (!hash && !diffKind) return;
        e.stopPropagation();
        closeGitDetail();
        disconnectGitObserver();
        gitDetailNeedsRefresh = false;
        gitPanel.classList.add("git-transitioning");
        const subject = diffKind
          ? (row.querySelector(".git-summary-label")?.textContent?.trim() || "Uncommitted changes")
          : (row.querySelector(".git-commit-subject")?.textContent?.trim() || hash.slice(0, 7));
        const headEl = gitPanel.querySelector(".git-commit-detail-head");
        const bodyEl = gitPanel.querySelector(".git-commit-detail-body");
        if (headEl) {
          headEl.title = subject;
          headEl.innerHTML = row.outerHTML;
        }
        if (!bodyEl) return;
        const wrapEl = document.createElement("div");
        wrapEl.className = "git-commit-file-wrap";
        bodyEl.appendChild(wrapEl);
        setGitSheetTitle("Git");
        gitPanel.classList.add("git-mode-detail");
        gitDetailContext = {
          kind: diffKind === "worktree" ? "worktree" : "commit",
          hash: diffKind === "worktree" ? "" : String(hash || ""),
          wrapEl,
        };
        const scrollRoot = gitScrollRootEl();
        if (scrollRoot) scrollRoot.scrollTop = 0;
        requestAnimationFrame(() => {
          gitPanel?.classList.remove("git-transitioning");
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
