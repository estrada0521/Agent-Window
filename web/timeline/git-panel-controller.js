    const createGitPanelController = (host) => {
      const state = {
        commits: [],
        nextOffset: 0,
        totalCommits: 0,
        hasMore: false,
        pageLoading: false,
        showLoadingUi: false,
        cancelLoading: () => {},
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
      const resetListScroll = () => {
        const scroller = scrollRoot();
        if (!scroller) return;
        if (host.pinListScroll) host.pinListScroll(scroller);
        else scroller.scrollTop = 0;
      };
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
          || '<div class="sheet-list-empty" data-git-empty="1">No commits</div>';
        const rowHtml = (commit) => gitCommitRowHtml(commit, host.commitRowOptions
          ? host.commitRowOptions(commit, newHashes)
          : { animate: !!(newHashes && newHashes.has(commit.hash)) });
        const rowKey = (el) => el.dataset.hash || "";
        if (!append) {
          const firstRects = captureListRowRects(listEl, ".git-commit-row", rowKey);
          if (!commits.length) {
            listEl.innerHTML = emptyHtml;
            return;
          }
          listEl.innerHTML = commits.map(rowHtml).join("");
          flipListRows(listEl, ".git-commit-row", rowKey, firstRects);
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
        } else if (state.pageLoading && state.showLoadingUi) {
          if (host.loadMoreLoadingHtml) {
            btn.classList.add("inline-loading-row");
            btn.innerHTML = host.loadMoreLoadingHtml;
          } else {
            btn.classList.remove("inline-loading-row");
            btn.textContent = "";
          }
        } else if (state.pageLoading) {
          btn.classList.remove("inline-loading-row");
          if (state.totalCommits > 0 && host.loadMoreCountText) {
            btn.textContent = host.loadMoreCountText(state.commits.length, state.totalCommits);
          } else {
            btn.textContent = host.loadMoreText || "Load more commits";
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
        if (reset) resetListScroll();
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
        const cancelStatsLoading = preserveCurrent
          ? () => {}
          : startDelayedLoading(() => {
            if (String(requestSeq) !== wrapEl.dataset.fileStatsRequestSeq) return;
            delete wrapEl.dataset.fileStatsSignature;
            wrapEl.innerHTML = `<div class="git-commit-file-empty sheet-list-empty inline-loading-row">${loadingIndicatorHtml()}</div>`;
          });
        if (!preserveCurrent) delete wrapEl.dataset.fileStatsSignature;
        let loaded;
        try {
          [loaded] = await Promise.all([
            loadGitDiffFileStats({ hash, scope }),
            ensureFileIconTheme(),
          ]);
        } finally {
          cancelStatsLoading();
        }
        if (String(requestSeq) !== wrapEl.dataset.fileStatsRequestSeq) return null;
        const scroller = scrollRoot();
        const savedScrollTop = preserveCurrent && scroller ? scroller.scrollTop : null;
        const restoreScroll = () => {
          if (savedScrollTop != null && scroller) scroller.scrollTop = savedScrollTop;
        };
        if (loaded.mode === "sections") {
          applyGitFileStatsSectionsInto(wrapEl, loaded.sections, {
            allowUndo,
            incremental,
            emptyHtml: '<div class="git-commit-file-empty sheet-list-empty">No changed files</div>',
            onBeforeFlip: restoreScroll,
          });
          restoreScroll();
          return { files: loaded.files };
        }
        if (!loaded.files.length) {
          wrapEl.dataset.fileStatsSignature = "";
          wrapEl.innerHTML = '<div class="git-commit-file-empty sheet-list-empty">No changed files</div>';
          restoreScroll();
          return loaded.data;
        }
        if (incremental && wrapEl.querySelector(".git-commit-file-list")) {
          applyGitFileStatsSectionsInto(wrapEl, [{ title: "", kind: scope || "commit", files: loaded.files }], {
            allowUndo,
            incremental,
            onBeforeFlip: restoreScroll,
          });
        } else {
          const fileRowKey = (el) => el.dataset.path || "";
          const firstRects = captureListRowRects(wrapEl, ".git-commit-file-row", fileRowKey);
          wrapEl.dataset.fileStatsSignature = gitFileStatsRowsSignature([{ kind: scope || "commit", files: loaded.files }]);
          wrapEl.innerHTML = gitCommitFileListHtml(loaded.files, { allowUndo, scope });
          restoreScroll();
          flipListRows(wrapEl, ".git-commit-file-row", fileRowKey, firstRects);
        }
        restoreScroll();
        return loaded.data;
      };
      const closeDetail = ({ refreshList = false } = {}) => {
        const rootEl = root();
        if (!rootEl) return;
        const hadDetail = !!state.detailContext;
        const el = modeEl();
        el?.classList.remove("git-transitioning", "git-instant", "git-mode-detail", "git-mode-worktree-detail");
        const body = rootEl.querySelector(".git-commit-detail-body");
        const head = rootEl.querySelector(".git-commit-detail-head");
        if (body) body.innerHTML = "";
        if (head) head.innerHTML = "";
        state.detailContext = null;
        host.onCloseDetail?.({ hadDetail });
        updateLoadMoreUi();
        ensureObserver();
        const shouldRefresh = !!refreshList;
        state.detailNeedsRefresh = false;
        if (shouldRefresh) void loadPage({ reset: true });
      };
      const openDetail = async ({
        diffKind = "",
        hash = "",
        rowHtml = "",
        subject = "",
        instant = false,
        seed = null,
      } = {}) => {
        const rootEl = root();
        if (!rootEl) return;
        const el = modeEl();
        if (!el) return;
        const isWorktree = diffKind === "worktree";
        closeDetail();
        disconnectObserver();
        state.detailNeedsRefresh = false;
        const headEl = rootEl.querySelector(".git-commit-detail-head");
        let bodyEl = rootEl.querySelector(".git-commit-detail-body");
        if (headEl) {
          headEl.title = subject;
          headEl.innerHTML = host.detailHeadHtml
            ? host.detailHeadHtml({ isWorktree, rowHtml })
            : rowHtml;
        }
        if (!bodyEl) return;
        if (!instant) {
          const freshBody = document.createElement("div");
          freshBody.className = bodyEl.className;
          bodyEl.replaceWith(freshBody);
          bodyEl = freshBody;
        }
        const wrapEl = document.createElement("div");
        wrapEl.className = "git-commit-file-wrap";
        const allowUndo = isWorktree;
        const scope = isWorktree ? "" : diffKind;
        let seeded = false;
        if (seed?.mode === "sections") {
          applyGitFileStatsSectionsInto(wrapEl, seed.sections, { allowUndo });
          seeded = true;
        } else if (Array.isArray(seed?.files) && seed.files.length) {
          wrapEl.dataset.fileStatsSignature = gitFileStatsRowsSignature([{ kind: scope || "commit", files: seed.files }]);
          wrapEl.innerHTML = gitCommitFileListHtml(seed.files, { allowUndo, scope });
          seeded = true;
        }
        const holdFiles = !!host.holdDetailFilesUntilReady && !seeded;
        if (holdFiles) wrapEl.hidden = true;
        if (instant) el.classList.add("git-instant");
        else el.classList.add("git-transitioning");
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
        host.onOpenDetail?.({ diffKind, hash, rowHtml, subject, isWorktree });
        resetListScroll();
        requestAnimationFrame(() => {
          el.classList.remove("git-transitioning");
          if (!instant) el.classList.remove("git-instant");
        });
        if (seeded) {
          host.onDetailFilesReady?.({
            wrapEl,
            hash: state.detailContext.hash,
            kind: state.detailContext.kind,
            isWorktree,
          });
          resetListScroll();
          return;
        }
        try {
          await renderFileStatsInto(wrapEl, isWorktree ? "" : hash, {
            allowUndo,
            scope,
          });
          if (holdFiles) wrapEl.hidden = false;
          host.onDetailFilesReady?.({
            wrapEl,
            hash: state.detailContext.hash,
            kind: state.detailContext.kind,
            isWorktree,
          });
        } catch (_) {
          wrapEl.innerHTML = '<div class="git-commit-file-empty sheet-list-empty error">Failed to load file stats</div>';
          if (holdFiles) wrapEl.hidden = false;
          host.onDetailFilesReady?.({
            wrapEl,
            hash: state.detailContext.hash,
            kind: state.detailContext.kind,
            isWorktree,
          });
        }
        resetListScroll();
      };
      const loadPage = async ({ reset = false } = {}) => {
        if (host.canLoad && !host.canLoad()) return;
        if (state.pageLoading) return;
        if (!reset && !state.hasMore && !state.loadError) return;
        const loadSeq = ++state.loadSeq;
        state.pageLoading = true;
        state.showLoadingUi = false;
        state.loadError = "";
        disconnectObserver();
        state.cancelLoading();
        if (reset) {
          state.refreshSeq += 1;
          closeDetail();
          host.onLoadReset?.();
          state.hasMore = false;
          state.nextOffset = 0;
          state.totalCommits = 0;
          state.commits = [];
          state.cancelLoading = startDelayedLoading(() => {
            if (loadSeq !== state.loadSeq) return;
            state.showLoadingUi = true;
            host.setBodyHtml(host.loadingHtml);
          });
        } else {
          state.cancelLoading = startDelayedLoading(() => {
            if (loadSeq !== state.loadSeq) return;
            state.showLoadingUi = true;
            updateLoadMoreUi();
          });
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
          state.cancelLoading();
          state.cancelLoading = () => {};
          state.pageLoading = false;
          state.showLoadingUi = false;
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
          const newHashes = state.overviewSig ? gitNewCommitHashes(state.commits, data?.recent_commits) : null;
          applyPaging(gitOverviewPagingFromResponse(data, [], { reset: true }), { reset: true, newHashes });
          host.onFingerprintChanged?.(data);
        }
        if (state.detailContext?.kind === "worktree" && state.detailContext?.wrapEl) {
          if (!data?.worktree_has_diff) {
            closeDetail({ refreshList: false });
          } else {
            await renderFileStatsInto(state.detailContext.wrapEl, "", {
              allowUndo: true,
              preserveCurrent: true,
              incremental: true,
            });
          }
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
        const row = event.target.closest(".git-commit-row, .git-summary-row, .git-worktree-button");
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
          ? "Uncommitted changes"
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
