    const createGitPanelSession = (host) => {
      const state = {
        commits: [],
        nextOffset: 0,
        totalCommits: 0,
        hasMore: false,
        pageLoading: false,
        loadError: "",
        loadSeq: 0,
        refreshSeq: 0,
        refreshInFlight: false,
        refreshQueued: false,
        overviewSig: "",
        detailContext: null,
        detailNeedsRefresh: false,
        observer: null,
      };
      const root = () => host.root();
      const modeEl = () => (host.modeEl ? host.modeEl() : root()?.querySelector(".git-stack")) || root();
      const observerRoot = () => (host.observerRoot ? host.observerRoot() : root());
      const scrollRoot = () => (host.scrollRoot ? host.scrollRoot() : observerRoot());
      const commitListEl = () => root()?.querySelector(".git-commit-list");
      const loadMoreEl = () => root()?.querySelector(".git-load-more");
      const disconnectObserver = () => {
        if (!state.observer) return;
        try { state.observer.disconnect(); } catch (_) { }
        state.observer = null;
      };
      const renderCommitRows = (commits, { append = false, newHashes = null } = {}) => {
        const listEl = commitListEl();
        if (!listEl) return;
        const emptyHtml = host.emptyCommitsHtml
          || '<div class="git-commit-file-empty" data-git-empty="1">No commits</div>';
        const rowHtml = (commit) => gitCommitRowHtml(commit, host.commitRowOptions
          ? host.commitRowOptions(commit, newHashes)
          : { animate: !!(newHashes && newHashes.has(commit.hash)) });
        if (!append) {
          if (!commits.length) {
            listEl.innerHTML = emptyHtml;
            return;
          }
          listEl.innerHTML = commits.map(rowHtml).join("");
          return;
        }
        if (!commits.length) return;
        listEl.querySelector("[data-git-empty]")?.remove();
        listEl.insertAdjacentHTML("beforeend", commits.map(rowHtml).join(""));
      };
      const updateLoadMoreUi = () => {
        const btn = loadMoreEl();
        if (!btn) return;
        if (!state.hasMore && !state.loadError) {
          btn.hidden = true;
          btn.disabled = true;
          btn.classList.remove("inline-loading-row");
          btn.textContent = "";
          return;
        }
        btn.hidden = false;
        btn.disabled = state.pageLoading;
        if (state.loadError) {
          btn.classList.remove("inline-loading-row");
          btn.textContent = host.loadMoreRetryText || "Retry loading commits";
        } else if (state.pageLoading) {
          if (host.loadMoreLoadingHtml) {
            btn.classList.add("inline-loading-row");
            btn.innerHTML = host.loadMoreLoadingHtml;
          } else {
            btn.classList.remove("inline-loading-row");
            btn.textContent = "";
          }
        } else if (state.totalCommits > 0) {
          btn.classList.remove("inline-loading-row");
          btn.textContent = host.loadMoreCountText
            ? host.loadMoreCountText(state.commits.length, state.totalCommits)
            : `Load more commits (${state.commits.length}/${state.totalCommits})`;
        } else {
          btn.classList.remove("inline-loading-row");
          btn.textContent = host.loadMoreText || "Load more commits";
        }
      };
      const ensureObserver = () => {
        disconnectObserver();
        const btn = loadMoreEl();
        if (!btn || !state.hasMore || state.pageLoading || state.loadError || typeof IntersectionObserver !== "function") return;
        state.observer = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            void loadPage();
          });
        }, {
          root: observerRoot(),
          rootMargin: "220px 0px 220px 0px",
          threshold: 0.01,
        });
        state.observer.observe(btn);
      };
      const applyPaging = (page, { reset = false, newHashes = null } = {}) => {
        state.commits = page.commits;
        state.totalCommits = page.totalCommits;
        state.nextOffset = page.nextOffset;
        state.hasMore = page.hasMore;
        if (reset) state.overviewSig = page.fingerprint;
        if (reset) {
          renderCommitRows(state.commits, { append: false, newHashes });
        } else if (page.pageCommits.length) {
          renderCommitRows(page.pageCommits, { append: true });
        }
        updateLoadMoreUi();
        ensureObserver();
      };
      const applyPage = (data, { reset = false, newHashes = null } = {}) => {
        if (reset) host.renderShell(data || {});
        host.onPage?.(data, { reset });
        applyPaging(gitOverviewPagingFromResponse(data, state.commits, { reset }), { reset, newHashes });
      };
      const renderFileStatsInto = async (
        wrapEl,
        hash,
        { allowUndo = false, scope = "", preserveCurrent = false, incremental = false } = {},
      ) => {
        if (host.renderFileStatsInto) {
          return host.renderFileStatsInto(wrapEl, hash, { allowUndo, scope, preserveCurrent, incremental });
        }
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
      const closeDetail = ({ refreshList = false } = {}) => {
        const rootEl = root();
        if (!rootEl) return;
        const el = modeEl();
        el?.classList.remove("git-transitioning", "git-mode-detail", "git-mode-worktree-detail");
        const body = rootEl.querySelector(".git-commit-detail-body");
        const head = rootEl.querySelector(".git-commit-detail-head");
        if (body) body.innerHTML = "";
        if (head) head.innerHTML = "";
        state.detailContext = null;
        host.onCloseDetail?.();
        updateLoadMoreUi();
        ensureObserver();
        const shouldRefresh = !!refreshList;
        state.detailNeedsRefresh = false;
        if (shouldRefresh) void loadPage({ reset: true });
      };
      const openDetail = async ({ diffKind = "", hash = "", rowHtml = "", subject = "" } = {}) => {
        const rootEl = root();
        if (!rootEl) return;
        const el = modeEl();
        if (!el) return;
        const isWorktree = diffKind === "worktree";
        closeDetail();
        disconnectObserver();
        state.detailNeedsRefresh = false;
        el.classList.add("git-transitioning");
        const headEl = rootEl.querySelector(".git-commit-detail-head");
        const bodyEl = rootEl.querySelector(".git-commit-detail-body");
        if (headEl) {
          headEl.title = subject;
          headEl.innerHTML = host.detailHeadHtml
            ? host.detailHeadHtml({ isWorktree, rowHtml })
            : rowHtml;
        }
        if (!bodyEl) return;
        const wrapEl = document.createElement("div");
        wrapEl.className = "git-commit-file-wrap";
        bodyEl.appendChild(wrapEl);
        el.classList.add("git-mode-detail");
        if (host.worktreeDetailClass && isWorktree) {
          el.classList.add("git-mode-worktree-detail");
        }
        state.detailContext = {
          kind: diffKind === "worktree" || diffKind === "staged" || diffKind === "unstaged" ? diffKind : "commit",
          hash: diffKind === "worktree" || diffKind === "staged" || diffKind === "unstaged" ? "" : String(hash || ""),
          wrapEl,
        };
        host.onOpenDetail?.();
        const scroller = scrollRoot();
        if (scroller) scroller.scrollTop = 0;
        requestAnimationFrame(() => el.classList.remove("git-transitioning"));
        try {
          await renderFileStatsInto(wrapEl, isWorktree ? "" : hash, {
            allowUndo: isWorktree,
            scope: isWorktree ? "" : diffKind,
          });
        } catch (_) {
          wrapEl.innerHTML = '<div class="git-commit-file-empty error">Failed to load file stats</div>';
        }
      };
      const loadPage = async ({ reset = false } = {}) => {
        if (host.canLoad && !host.canLoad()) return;
        if (state.pageLoading) return;
        if (!reset && !state.hasMore && !state.loadError) return;
        const loadSeq = ++state.loadSeq;
        state.pageLoading = true;
        state.loadError = "";
        disconnectObserver();
        if (reset) {
          state.refreshSeq += 1;
          closeDetail();
          host.onLoadReset?.();
          state.hasMore = false;
          state.nextOffset = 0;
          state.totalCommits = 0;
          state.commits = [];
          host.setBodyHtml(host.loadingHtml);
        } else {
          updateLoadMoreUi();
        }
        try {
          const data = await fetchGitOverview({
            offset: reset ? 0 : state.nextOffset,
            refresh: reset,
          });
          if (loadSeq !== state.loadSeq) return;
          applyPage(data, { reset });
        } catch (err) {
          if (loadSeq !== state.loadSeq) return;
          if (reset) {
            host.setBodyHtml(host.errorHtml(err?.message || "Failed to load git overview"));
          } else {
            state.loadError = err?.message || "Failed to load more commits";
          }
        } finally {
          if (loadSeq !== state.loadSeq) return;
          state.pageLoading = false;
          updateLoadMoreUi();
          ensureObserver();
          if (state.refreshQueued) {
            state.refreshQueued = false;
            void refresh();
          }
        }
      };
      const runRefresh = async () => {
        const refreshSeq = ++state.refreshSeq;
        const data = await fetchGitOverview({ offset: 0, refresh: true });
        if (refreshSeq !== state.refreshSeq) return;
        host.onOverview?.(data);
        const nextSig = gitOverviewFingerprint(data);
        if (nextSig !== state.overviewSig) {
          const isFirst = !state.overviewSig;
          const decision = host.onFingerprintChanged?.(data, {
            isFirst,
            previousCommits: state.commits,
            detailContext: state.detailContext,
          }) || { updateList: !state.detailContext };
          if (decision.updateList !== false) {
            applyPaging(gitOverviewPagingFromResponse(data, [], { reset: true }), {
              reset: true,
              newHashes: decision.newHashes ?? null,
            });
          } else {
            state.overviewSig = nextSig;
          }
        }
        if (state.detailContext?.kind === "worktree" && state.detailContext?.wrapEl) {
          await renderFileStatsInto(state.detailContext.wrapEl, "", {
            allowUndo: true,
            preserveCurrent: true,
            incremental: true,
          });
        }
      };
      const refresh = async () => {
        if (host.canRefresh && !host.canRefresh()) return;
        if (state.pageLoading || state.refreshInFlight) {
          state.refreshQueued = true;
          return;
        }
        state.refreshInFlight = true;
        try {
          while (true) {
            state.refreshQueued = false;
            await runRefresh();
            if (!state.refreshQueued) break;
          }
        } finally {
          state.refreshInFlight = false;
          if (state.refreshQueued) {
            state.refreshQueued = false;
            void refresh();
          }
        }
      };
      const handleClick = async (event, {
        onPin = null,
        requireOpen = null,
        onFileRow = null,
        closeWorktreeSummaryClick = false,
      } = {}) => {
        const rootEl = root();
        if (!rootEl) return;
        if (onPin && event.target.closest(".git-summary-pin")) {
          event.preventDefault();
          event.stopPropagation();
          onPin();
          return;
        }
        if (requireOpen && !requireOpen()) return;
        const loadMoreBtn = event.target.closest(".git-load-more");
        if (loadMoreBtn) {
          event.preventDefault();
          event.stopPropagation();
          await loadPage();
          return;
        }
        if (onFileRow) {
          const fileRow = event.target.closest(".git-commit-file-row");
          if (fileRow) {
            event.preventDefault();
            await onFileRow(fileRow);
            return;
          }
        }
        if (event.target.closest(".git-commit-detail-head")) {
          event.preventDefault();
          event.stopPropagation();
          closeDetail({ refreshList: state.detailNeedsRefresh });
          return;
        }
        const row = event.target.closest(".git-commit-row, .git-summary-row");
        if (!row) return;
        if (
          closeWorktreeSummaryClick
          && modeEl()?.classList.contains("git-mode-worktree-detail")
          && row.closest(".git-summary-wrap")
        ) {
          event.preventDefault();
          event.stopPropagation();
          closeDetail({ refreshList: state.detailNeedsRefresh });
          return;
        }
        if (modeEl()?.classList.contains("git-mode-detail")) return;
        const diffKind = row.dataset.diffKind || "";
        const hash = String(row.dataset.hash || "");
        if (!hash && !diffKind) return;
        event.preventDefault();
        event.stopPropagation();
        const subject = diffKind
          ? (row.querySelector(".git-summary-label")?.textContent?.trim() || "Uncommitted changes")
          : (row.querySelector(".git-commit-subject")?.textContent?.trim() || hash.slice(0, 7));
        await openDetail({ diffKind, hash, rowHtml: row.outerHTML, subject });
      };
      return {
        get commits() { return state.commits; },
        get pageLoading() { return state.pageLoading; },
        get detailContext() { return state.detailContext; },
        get detailNeedsRefresh() { return state.detailNeedsRefresh; },
        get overviewSig() { return state.overviewSig; },
        invalidateFingerprint() { state.overviewSig = ""; },
        setFingerprint(fp) { state.overviewSig = fp || ""; },
        hasShell() { return !!root()?.querySelector(".git-stack"); },
        loadPage,
        refresh,
        openDetail,
        closeDetail,
        handleClick,
        renderFileStatsInto,
        disconnectObserver,
      };
    };
