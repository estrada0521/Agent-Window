__CHAT_INCLUDE:../../../shared/chat/git-panel-html.js__
__CHAT_INCLUDE:../../../shared/chat/git-panel-data.js__
__CHAT_INCLUDE:../../../shared/chat/git-panel-session.js__
    const gitSheetTitleEl = () => sharedSheetTitleEl;
    const setGitSheetTitle = () => {
      const titleEl = gitSheetTitleEl();
      if (!titleEl) return;
      titleEl.classList.remove("git-sheet-detail-title", "git-sheet-title");
      titleEl.textContent = "Git";
      titleEl.title = "Git";
    };
    const gitWorktreeButton = () => mobileSheet?.querySelector(".git-worktree-button");
    const showGitWorktreeButton = () => {
      const btn = gitWorktreeButton();
      if (btn) btn.hidden = !!gitSession.detailContext;
    };
    const hideGitWorktreeButton = () => {
      const btn = gitWorktreeButton();
      if (btn) btn.hidden = true;
    };
    const animateGitSheetList = (selector, transition) => {
      const list = gitHostEl()?.querySelector(selector);
      if (!list) return;
      delete list.dataset.transition;
      void list.offsetWidth;
      list.dataset.transition = transition;
    };
    const renderGitWorktreeButton = (data) => {
      let btn = gitWorktreeButton();
      if (!btn) {
        const sheetPanel = mobileSheet?.querySelector(".mobile-bottom-sheet-panel");
        if (!sheetPanel) return;
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "git-worktree-button mobile-bottom-sheet-button";
        sheetPanel.appendChild(btn);
      }
      const changedPaths = Math.max(0, parseInt(data?.worktree_changed_paths) || 0);
      const added = Math.max(0, parseInt(data?.worktree_added) || 0);
      const deleted = Math.max(0, parseInt(data?.worktree_deleted) || 0);
      const hasDiff = !!data?.worktree_has_diff;
      btn.disabled = !hasDiff;
      btn.classList.toggle("clickable", hasDiff);
      if (hasDiff) btn.dataset.diffKind = "worktree";
      else delete btn.dataset.diffKind;
      btn.setAttribute("aria-label", hasDiff ? "Open uncommitted changes" : "Working tree clean");
      btn.innerHTML = `<span class="git-worktree-button-label">${gitPathCountText(changedPaths)}</span>${gitCountsHtml(added, deleted)}`;
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
        if (countsEl) titleEl.appendChild(countsEl.cloneNode(true));
        titleEl.title = subject;
      }
      hideGitWorktreeButton();
      setSharedSheetLeading(
        () => gitSession.closeDetail({ refreshList: gitSession.detailNeedsRefresh }),
        "Back to commits",
        mobileSheetBackIcon,
      );
    };
    const renderGitCommitInfo = async (hash) => {
      const info = await gitCommitInfo(hash);
      const bodyEl = gitHostEl()?.querySelector(".git-commit-detail-body");
      if (!bodyEl || gitSession.detailContext?.hash !== hash) return;
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
        messageEl.textContent = body;
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
      bodyEl.prepend(blockEl);
    };
    const setGitDetailChrome = ({ rowHtml = "", subject = "Git", hash = "", isWorktree = false } = {}) => {
      _gitDetailChrome = { rowHtml, subject };
      applyGitDetailChrome(_gitDetailChrome);
      animateGitSheetList(".git-detail-view", "forward");
      if (isWorktree || !hash) return;
      const titleEl = document.createElement("div");
      titleEl.className = "git-commit-file-section-title";
      titleEl.textContent = "Changed";
      gitHostEl()?.querySelector(".git-commit-detail-body")?.prepend(titleEl);
      void renderGitCommitInfo(hash);
    };
    const refreshGitDetailTitleFromOverview = (data) => {
      if (!_gitDetailChrome || gitSession.detailContext?.kind === "commit") return;
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
      gitSession.detailContext ? ".git-detail-view" : ".git-list-view"
    ) || gitHostEl();
    const gitSession = createGitPanelSession({
      root: () => gitHostEl(),
      modeEl: () => gitHostEl()?.querySelector(".git-stack") || gitHostEl(),
      observerRoot: gitSheetListEl,
      scrollRoot: gitSheetListEl,
      pinListScroll: resetSheetListScroll,
      canLoad: () => !!mobileSheet,
      canRefresh: () => !!mobileSheet,
      renderShell: (data) => {
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
      loadMoreLoadingHtml: loadingIndicatorHtml(),
      loadMoreRetryText: "Retry loading commits",
      loadMoreCountText: (loaded, total) => `Load more commits (${loaded}/${total})`,
      onLoadReset: () => {
        setGitSheetTitle();
        hideGitWorktreeButton();
      },
      onCloseDetail: resetGitDetailChrome,
      onOpenDetail: setGitDetailChrome,
      onOverview: refreshGitDetailTitleFromOverview,
      onFingerprintChanged: (data) => {
        const previous = gitCountSnapshot(gitWorktreeButton());
        renderGitWorktreeButton(data || {});
        animateGitCountsFromSnapshot(gitWorktreeButton(), previous);
        return { updateList: true };
      },
    });
    const updateGitPanel = async () => {
      if (!mobileSheet) return;
      if (gitSession.hasShell()) {
        try {
          await gitSession.refresh();
        } catch (_) { }
        return;
      }
      await gitSession.loadPage({ reset: true });
    };
    mobileSheet?.addEventListener("click", (event) => {
      void gitSession.handleClick(event, {
        onFileRow: async (fileRow) => {
          const path = String(fileRow.dataset.path || "").trim();
          if (!path) return;
          await openSheetPreview(path, extFromPath(path), { kind: "git" });
        },
      });
    });
