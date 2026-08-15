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
    const GIT_BRANCH_BATCH = 50;
    const disconnectGitBranchObserver = () => {
      if (!gitBranchObserver) return;
      try { gitBranchObserver.disconnect(); } catch (_) { }
      gitBranchObserver = null;
    };
    const gitBranchCommitListEl = () => gitBranchPanel?.querySelector(".git-branch-commit-list");
    const gitBranchLoadMoreEl = () => gitBranchPanel?.querySelector(".git-branch-load-more");
    const gitBranchScrollRootEl = () => gitBranchSheetContentEl() || gitBranchPanel;
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
    const gitBranchCountsHtml = (ins, dels) => {
      const safeIns = Math.max(0, parseInt(ins) || 0);
      const safeDels = Math.max(0, parseInt(dels) || 0);
      const cleanClass = (safeIns || safeDels) ? "" : " clean";
      return `<span class="git-branch-summary-counts${cleanClass}"><span class="git-branch-summary-count ins" data-count-prefix="+" data-count-value="${safeIns}">+${safeIns}</span><span class="git-branch-summary-count del" data-count-prefix="-" data-count-value="${safeDels}">-${safeDels}</span></span>`;
    };
    const shouldAnimateGitBranchCounts = () =>
      !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const gitBranchCountSnapshot = (root) =>
      root
        ? Array.from(root.querySelectorAll(".git-branch-summary-row .git-branch-summary-count"))
            .map((el) => Math.max(0, parseInt(el.dataset.countValue || el.textContent || "0") || 0))
        : [];
    const alignGitBranchCountDigits = (from, to) => {
      const fromStr = String(Math.max(0, parseInt(from) || 0));
      const toStr = String(Math.max(0, parseInt(to) || 0));
      const maxLen = Math.max(fromStr.length, toStr.length);
      const cols = [];
      for (let i = 0; i < maxLen; i++) {
        const fromIdx = fromStr.length - maxLen + i;
        const toIdx = toStr.length - maxLen + i;
        cols.push({
          start: fromIdx >= 0 ? parseInt(fromStr[fromIdx], 10) : 0,
          end: toIdx >= 0 ? parseInt(toStr[toIdx], 10) : 0,
        });
      }
      return cols;
    };
    const visibleGitBranchCountRollColumns = (cols, to) => {
      const toNum = Math.max(0, parseInt(to) || 0);
      if (!cols.length) return cols;
      if (toNum === 0) {
        const firstNonZero = cols.findIndex((col) => col.start !== 0);
        return [cols[firstNonZero >= 0 ? firstNonZero : cols.length - 1]];
      }
      const toLen = String(toNum).length;
      return cols.slice(-Math.min(cols.length, toLen));
    };
    const buildGitBranchCountRollHtml = (prefix, columns) => {
      const digitHtml = columns.map(({ start }) => {
        const items = Array.from({ length: 10 }, (_, d) =>
          `<span class="git-count-roll-item">${d}</span>`
        ).join("");
        return `<span class="git-count-roll-digit"><span class="git-count-roll-strip" style="transform:translateY(calc(${start} * -1.2em))">${items}</span></span>`;
      }).join("");
      return `<span class="git-count-roll"><span class="git-count-roll-prefix">${prefix}</span><span class="git-count-roll-digits">${digitHtml}</span></span>`;
    };
    const animateGitBranchCount = (el, fromValue, toValue) => {
      const prefix = el.dataset.countPrefix || "";
      const from = Math.max(0, parseInt(fromValue) || 0);
      const to = Math.max(0, parseInt(toValue) || 0);
      if (!shouldAnimateGitBranchCounts() || from === to) {
        el.textContent = `${prefix}${to}`;
        return;
      }
      const columns = visibleGitBranchCountRollColumns(alignGitBranchCountDigits(from, to), to);
      if (!columns.length || columns.every((col) => col.start === col.end)) {
        el.textContent = `${prefix}${to}`;
        return;
      }
      const durationMs = 900;
      const staggerMs = 70;
      el.innerHTML = buildGitBranchCountRollHtml(prefix, columns);
      el.classList.add("is-rolling");
      const strips = Array.from(el.querySelectorAll(".git-count-roll-strip"));
      const finish = () => {
        el.classList.remove("is-rolling");
        el.textContent = `${prefix}${to}`;
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          strips.forEach((strip, i) => {
            const end = columns[i].end;
            strip.style.transition = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
            strip.style.transitionDelay = `${i * staggerMs}ms`;
            strip.style.transform = `translateY(calc(${end} * -1.2em))`;
          });
        });
      });
      window.setTimeout(finish, durationMs + (columns.length - 1) * staggerMs + 48);
    };
    const animateGitBranchCountsFromSnapshot = (root, previous) => {
      if (!root || !previous?.length) return;
      root.querySelectorAll(".git-branch-summary-row .git-branch-summary-count").forEach((el, idx) => {
        if (idx >= previous.length) return;
        animateGitBranchCount(el, previous[idx], el.dataset.countValue || el.textContent || "0");
      });
    };
    const gitBranchPathCountText = (count) => {
      const safeCount = Math.max(0, parseInt(count) || 0);
      return `${safeCount} ${safeCount === 1 ? "path" : "paths"}`;
    };
    const buildGitBranchSummaryHtml = (data) => {
      const changedPaths = parseInt(data?.worktree_changed_paths) || 0;
      const worktreeAdded = parseInt(data?.worktree_added) || 0;
      const worktreeDeleted = parseInt(data?.worktree_deleted) || 0;
      const worktreeClickable = !!data?.worktree_has_diff;
      const worktreeLabel = changedPaths
        ? "Uncommitted changes"
        : "Working tree clean";
      const worktreeMeta = changedPaths
        ? `<span class="git-branch-summary-meta-text">${gitBranchPathCountText(changedPaths)}</span>`
        : `<span class="git-branch-summary-meta-text">No changes</span>`;
      const worktreeCounts = gitBranchCountsHtml(worktreeAdded, worktreeDeleted);
      const summaryChevron = worktreeClickable
        ? '<svg class="git-commit-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>'
        : "";
      return `<div class="git-branch-summary-row${worktreeClickable ? " clickable" : ""}"${worktreeClickable ? ' data-diff-kind="worktree"' : ""}>` +
        `<div class="git-commit-info"><div class="git-branch-summary-label">${escapeHtml(worktreeLabel)}</div><div class="git-commit-meta">${worktreeMeta}${worktreeCounts}</div></div>` +
        summaryChevron +
        `</div>`;
    };
    const buildGitBranchCommitRowHtml = (commit) => {
      const iconHtml = '<span class="git-commit-icon-wrap"><span class="git-commit-dot" aria-hidden="true"></span></span>';
      const subjHtml = `<div class="git-commit-subject">${escapeHtml(commit?.subject || "")}</div>`;
      const ins = Math.max(0, parseInt(commit?.ins) || 0);
      const dels = Math.max(0, parseInt(commit?.dels) || 0);
      const statHtml = gitBranchCountsHtml(ins, dels);
      return `<div class="git-commit-row" data-hash="${escapeHtml(commit?.hash || "")}">${iconHtml}<div class="git-commit-info">${subjHtml}<div class="git-commit-meta">${statHtml}</div></div></div>`;
    };
    const renderGitBranchCommitRows = (commits, { append = false } = {}) => {
      const listEl = gitBranchCommitListEl();
      if (!listEl) return;
      if (!append) {
        if (!commits.length) {
          listEl.innerHTML = '<div class="hub-page-menu-item" data-git-branch-empty="1" style="cursor:default;opacity:0.52">No commits</div>';
          return;
        }
        listEl.innerHTML = commits.map((commit) => buildGitBranchCommitRowHtml(commit)).join("");
        return;
      }
      if (!commits.length) return;
      listEl.querySelector("[data-git-branch-empty]")?.remove();
      listEl.insertAdjacentHTML("beforeend", commits.map((commit) => buildGitBranchCommitRowHtml(commit)).join(""));
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
      const summaryHtml = buildGitBranchSummaryHtml(data);
      setGitBranchPanelBodyHtml(`
        <div class="git-branch-stack">
          <div class="git-branch-list-view">
            <div class="git-branch-summary-wrap">${summaryHtml}</div>
            <div class="git-branch-commit-list"></div>
            <button type="button" class="hub-page-menu-item git-branch-load-more" hidden></button>
          </div>
          <div class="git-branch-detail-view">
            <button type="button" class="git-commit-detail-head" aria-label="コミット一覧に戻る"></button>
            <div class="git-commit-detail-body"></div>
          </div>
        </div>`);
    };
    const gitBranchOverviewSignature = (data) => JSON.stringify({
      worktree_changed_paths: Math.max(0, parseInt(data?.worktree_changed_paths) || 0),
      worktree_added: Math.max(0, parseInt(data?.worktree_added) || 0),
      worktree_deleted: Math.max(0, parseInt(data?.worktree_deleted) || 0),
      worktree_has_diff: !!data?.worktree_has_diff,
      total_commits: Math.max(0, parseInt(data?.total_commits) || 0),
      next_offset: Math.max(0, parseInt(data?.next_offset) || 0),
      has_more: !!data?.has_more,
      commits: (Array.isArray(data?.recent_commits) ? data.recent_commits : []).map((commit) => ({
        hash: String(commit?.hash || ""),
        subject: String(commit?.subject || ""),
        ins: Math.max(0, parseInt(commit?.ins) || 0),
        dels: Math.max(0, parseInt(commit?.dels) || 0),
      })),
    });
    const applyGitBranchOverviewPage = (data, { reset = false } = {}) => {
      const commits = Array.isArray(data?.recent_commits) ? data.recent_commits : [];
      if (reset) {
        renderGitBranchPanelShell(data || {});
        gitBranchCommits = [];
      }
      if (commits.length) {
        gitBranchCommits = reset ? commits.slice() : gitBranchCommits.concat(commits);
      } else if (reset) {
        gitBranchCommits = [];
      }
      gitBranchTotalCommits = Math.max(0, parseInt(data?.total_commits) || 0);
      gitBranchNextOffset = Math.max(0, parseInt(data?.next_offset) || gitBranchCommits.length);
      gitBranchHasMore = !!data?.has_more;
      if (reset) {
        renderGitBranchCommitRows(gitBranchCommits, { append: false });
        gitBranchOverviewSig = gitBranchOverviewSignature(data);
      } else if (commits.length) {
        renderGitBranchCommitRows(commits, { append: true });
      }
      updateGitBranchLoadMoreUi();
      ensureGitBranchObserver();
    };
    const refreshGitBranchOverviewView = async () => {
      if (!gitBranchPanel) return;
      const refreshSeq = ++gitBranchRefreshSeq;
      const params = new URLSearchParams({
        offset: "0",
        limit: String(GIT_BRANCH_BATCH),
      });
      params.set("refresh", "1");
      const res = await fetchWithTimeout(`/git-branch-overview?${params.toString()}`, {}, 5000);
      if (!res.ok) throw new Error("Failed to refresh branch overview");
      const data = await res.json();
      if (refreshSeq !== gitBranchRefreshSeq) return;
      const nextOverviewSig = gitBranchOverviewSignature(data);
      if (nextOverviewSig !== gitBranchOverviewSig) {
        const summaryWrap = gitBranchPanel.querySelector(".git-branch-summary-wrap");
        if (summaryWrap) {
          const previous = gitBranchCountSnapshot(summaryWrap);
          summaryWrap.innerHTML = buildGitBranchSummaryHtml(data || {});
          animateGitBranchCountsFromSnapshot(summaryWrap, previous);
        }
        gitBranchCommits = Array.isArray(data?.recent_commits) ? data.recent_commits.slice() : [];
        gitBranchTotalCommits = Math.max(0, parseInt(data?.total_commits) || 0);
        gitBranchNextOffset = Math.max(0, parseInt(data?.next_offset) || gitBranchCommits.length);
        gitBranchHasMore = !!data?.has_more;
        renderGitBranchCommitRows(gitBranchCommits, { append: false });
        updateGitBranchLoadMoreUi();
        ensureGitBranchObserver();
        gitBranchOverviewSig = nextOverviewSig;
      }
      if (gitBranchDetailContext?.kind === "worktree" && gitBranchDetailContext?.wrapEl) {
        await renderGitCommitFileStatsInto(gitBranchDetailContext.wrapEl, "", {
          allowUndo: true,
          preserveCurrent: true,
        });
      }
    };
    const buildGitCommitFileRowHtml = (entry) => {
      const path = String(entry?.path || "").trim();
      const ins = Math.max(0, parseInt(entry?.ins) || 0);
      const dels = Math.max(0, parseInt(entry?.dels) || 0);
      const isUntracked = !!entry?.untracked;
      const ext = fileExtForPath(path);
      const iconSvg = FILE_ICONS[ext] || FILE_SVG_ICONS.file;
      const iconHtml = `<span class="git-commit-file-icon">${iconSvg}</span>`;
      const slashIdx = path.lastIndexOf("/");
      const fileName = slashIdx >= 0 ? path.slice(slashIdx + 1) : path;
      const dirPath = slashIdx >= 0 ? path.slice(0, slashIdx) : "";
      const pathHtml = dirPath
        ? `<span class="git-commit-file-name">${escapeHtml(fileName)}</span><span class="git-commit-file-dir">${escapeHtml(dirPath)}</span>`
        : `<span class="git-commit-file-name">${escapeHtml(fileName)}</span>`;
      const fileMetaHtml = isUntracked ? "" : `<div class="git-commit-file-meta">${gitBranchCountsHtml(ins, dels)}</div>`;
      const actionsHtml = fileMetaHtml ? `<div class="git-commit-file-actions">${fileMetaHtml}</div>` : "";
      const untrackedAttr = isUntracked ? ' data-untracked="1"' : "";
      return `<div class="git-commit-file-row clickable" data-path="${escapeHtml(path)}"${untrackedAttr}><div class="git-commit-file-header">${iconHtml}<div class="git-commit-file-path" title="${escapeHtml(path)}">${pathHtml}</div>${actionsHtml}</div></div>`;
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
        delete wrapEl.dataset.fileStatsSig;
        wrapEl.innerHTML = `<div class="git-commit-file-empty inline-loading-row">${loadingIndicatorHtml("Loading…")}</div>`;
      }
      if (!hash && !scope) {
        const [stagedRes, unstagedRes, untrackedRes] = await Promise.all([
          fetchWithTimeout("/git-diff-files?scope=staged", {}, 5000),
          fetchWithTimeout("/git-diff-files?scope=unstaged", {}, 5000),
          fetchWithTimeout("/git-diff-files?scope=untracked", {}, 5000),
        ]);
        const stagedData = await stagedRes.json();
        const unstagedData = await unstagedRes.json();
        const untrackedData = await untrackedRes.json();
        if (String(requestSeq) !== wrapEl.dataset.fileStatsRequestSeq) return null;
        const sections = [
          { title: "Staged", kind: "staged", data: stagedData },
          { title: "Unstaged", kind: "unstaged", data: unstagedData },
          { title: "Untracked", kind: "untracked", data: untrackedData },
        ].filter((section) => Array.isArray(section.data?.files) && section.data.files.length);
        const nextSig = JSON.stringify(sections.map((section) => ({
          kind: section.kind,
          files: (section.data.files || []).map((entry) => ({
            path: String(entry?.path || ""),
            ins: Math.max(0, parseInt(entry?.ins) || 0),
            dels: Math.max(0, parseInt(entry?.dels) || 0),
            untracked: !!entry?.untracked,
          })),
        })));
        if (preserveCurrent && wrapEl.dataset.fileStatsSig === nextSig) {
          return { files: sections.flatMap((section) => section.data.files || []) };
        }
        wrapEl.dataset.fileStatsSig = nextSig;
        if (!sections.length) {
          wrapEl.innerHTML = '<div class="git-commit-file-empty">No changed files</div>';
          return { files: [] };
        }
        wrapEl.innerHTML = `<div class="git-commit-file-sections">${sections.map((section) => `<section class="git-commit-file-section" data-scope="${escapeHtml(section.kind)}"><div class="git-commit-file-section-title">${escapeHtml(section.title)}</div><div class="git-commit-file-list">${section.data.files.map((entry) => buildGitCommitFileRowHtml(entry, { allowUndo, scope: section.kind })).join("")}</div></section>`).join("")}</div>`;
        return { files: sections.flatMap((section) => section.data.files || []) };
      }
      const params = new URLSearchParams({ hash: String(hash || "") });
      if (!hash && scope) params.set("scope", scope);
      const res = await fetchWithTimeout(`/git-diff-files?${params.toString()}`, {}, 5000);
      const data = await res.json();
      if (String(requestSeq) !== wrapEl.dataset.fileStatsRequestSeq) return null;
      const files = Array.isArray(data?.files) ? data.files : [];
      const nextSig = JSON.stringify({
        hash: String(hash || ""),
        scope: String(scope || ""),
        files: files.map((entry) => ({
          path: String(entry?.path || ""),
          ins: Math.max(0, parseInt(entry?.ins) || 0),
          dels: Math.max(0, parseInt(entry?.dels) || 0),
          untracked: !!entry?.untracked,
        })),
      });
      if (preserveCurrent && wrapEl.dataset.fileStatsSig === nextSig) return data;
      wrapEl.dataset.fileStatsSig = nextSig;
      if (!files.length) {
        wrapEl.innerHTML = '<div class="git-commit-file-empty">No changed files</div>';
        return data;
      }
      wrapEl.innerHTML = `<div class="git-commit-file-list">${files.map((entry) => buildGitCommitFileRowHtml(entry, { allowUndo, scope })).join("")}</div>`;
      return data;
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
        setGitBranchPanelBodyHtml(`<div class="hub-page-menu-item inline-loading-row" style="cursor:default">${loadingIndicatorHtml("Loading…")}</div>`);
      } else {
        updateGitBranchLoadMoreUi();
      }
      try {
        const params = new URLSearchParams({
          offset: String(reset ? 0 : gitBranchNextOffset),
          limit: String(GIT_BRANCH_BATCH),
        });
        if (reset) params.set("refresh", "1");
        const res = await fetchWithTimeout(`/git-branch-overview?${params.toString()}`, {}, 5000);
        if (!res.ok) throw new Error(reset ? "Failed to load branch overview" : "Failed to load more commits");
        const data = await res.json();
        if (loadSeq !== gitBranchLoadSeq) return;
        applyGitBranchOverviewPage(data, { reset });
      } catch (err) {
        if (loadSeq !== gitBranchLoadSeq) return;
        if (reset) {
          setGitBranchPanelBodyHtml(`<div class="hub-page-menu-item" style="cursor:default;opacity:0.72">${escapeHtml(err?.message || "Failed to load branch overview")}</div>`);
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