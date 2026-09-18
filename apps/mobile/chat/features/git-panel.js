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
    const gitWorktreeSummaryBtn = () => gitPanel?.querySelector(".git-worktree-summary");
    const showGitWorktreeSummary = () => {
      const btn = gitWorktreeSummaryBtn();
      if (btn) btn.hidden = !!gitSession.detailContext;
    };
    const hideGitWorktreeSummary = () => {
      const btn = gitWorktreeSummaryBtn();
      if (btn) btn.hidden = true;
    };
    const animateGitSheetList = (selector, transition) => {
      const list = gitPanel?.querySelector(selector);
      if (!list) return;
      delete list.dataset.transition;
      void list.offsetWidth;
      list.dataset.transition = transition;
    };
    const renderGitWorktreeSummary = (data) => {
      let btn = gitWorktreeSummaryBtn();
      if (!btn) {
        const sheetPanel = gitPanel?.querySelector(".git-sheet-panel");
        if (!sheetPanel) return;
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "git-worktree-summary git-summary-row mobile-bottom-sheet-button";
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
      btn.innerHTML = `<span class="git-summary-meta-text">${gitPathCountText(changedPaths)}</span>${gitCountsHtml(added, deleted)}`;
      showGitWorktreeSummary();
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
      hideGitWorktreeSummary();
      setSharedSheetLeading(
        () => gitSession.closeDetail({ refreshList: gitSession.detailNeedsRefresh }),
        "Back to commits",
        mobileSheetBackIcon,
      );
    };
    const setGitDetailChrome = ({ rowHtml = "", subject = "Git" } = {}) => {
      _gitDetailChrome = { rowHtml, subject };
      applyGitDetailChrome(_gitDetailChrome);
      animateGitSheetList(".git-detail-view", "forward");
    };
    const resetGitDetailChrome = ({ hadDetail = false } = {}) => {
      _gitDetailChrome = null;
      setGitSheetTitle();
      setSharedSheetLeading(null);
      showGitWorktreeSummary();
      if (hadDetail) animateGitSheetList(".git-list-view", "back");
    };
    const setGitPanelBodyHtml = (html) => {
      const contentEl = ensureGitSheetDom();
      if (contentEl) {
        const keep = contentEl.querySelector(".git-preview-view");
        contentEl.innerHTML = html;
        if (keep) contentEl.appendChild(keep);
        else ensureGitPreviewView(contentEl);
        return;
      }
      if (gitPanel) gitPanel.innerHTML = html;
    };
    const ensureGitPreviewView = (contentEl) => {
      const host = contentEl || gitPanel?.querySelector(".git-sheet-content");
      if (!host) return null;
      let view = host.querySelector(".git-preview-view");
      if (view) return view;
      view = document.createElement("div");
      view.className = "git-preview-view mobile-sheet-view";
      const frame = document.createElement("iframe");
      frame.className = "git-preview-frame";
      frame.title = "File preview";
      view.appendChild(frame);
      host.appendChild(view);
      return view;
    };
    const clearGitPreview = () => {
      if (gitPanel) {
        delete gitPanel._previewPath;
        delete gitPanel._previewExt;
      }
      gitPanel?.classList.remove("git-mode-preview");
      resetEmbeddedFilePreviewFrame(gitPreviewFrameEl());
      resetRepoPreviewControls();
      if (_gitDetailChrome) applyGitDetailChrome(_gitDetailChrome);
    };
    const closeGitPreview = () => {
      if (!gitPreviewInPreviewMode()) return;
      clearGitPreview();
    };
    const openGitPreview = async (rawPath, ext) => {
      const path = String(rawPath || "").trim();
      const normalizedExt = String(ext || fileExtForPath(path) || "").toLowerCase();
      if (!path || !gitPanel) return;
      const exists = await fileExistsOnDisk(path);
      if (!exists) {
        setStatus(`file not found: ${displayAttachmentFilename(path) || path}`, true);
        setTimeout(() => setStatus(""), STATUS_TOAST_MS);
        return;
      }
      ensureGitSheetDom();
      const view = ensureGitPreviewView();
      const frame = view?.querySelector(".git-preview-frame");
      if (!frame) return;
      gitPanel._previewPath = path;
      gitPanel._previewExt = normalizedExt;
      gitPanel.classList.add("git-mode-preview");
      const filename = (displayAttachmentFilename(path) || path || "Preview").trim();
      sharedSheetTitleEl.textContent = filename;
      sharedSheetTitleEl.title = filename;
      sharedSheetTitleEl.classList.remove("git-sheet-detail-title", "git-sheet-title");
      setSharedSheetLeading(() => closeGitPreview(), "Back", mobileSheetBackIcon);
      initRepoPreviewControls();
      wireEmbeddedFilePreviewFrame(frame, path, normalizedExt);
    };
    const gitSheetListEl = () => gitPanel?.querySelector(
      gitSession.detailContext ? ".git-detail-view .mobile-sheet-list" : ".git-list-view .mobile-sheet-list"
    ) || gitPanel;
    const gitSession = createGitPanelSession({
      root: () => gitPanel,
      modeEl: () => gitPanel?.querySelector(".git-stack") || gitPanel,
      observerRoot: gitSheetListEl,
      scrollRoot: gitSheetListEl,
      canLoad: () => !!gitPanel,
      canRefresh: () => !!gitPanel,
      renderShell: (data) => {
        renderGitWorktreeSummary(data);
        setGitPanelBodyHtml(`
        <div class="git-stack mobile-sheet-stack mobile-sheet-stage">
          <div class="git-list-view mobile-sheet-view mobile-sheet-list">
            <div class="git-commit-list"></div>
            <button type="button" class="page-menu-item git-load-more" hidden></button>
          </div>
          <div class="git-detail-view mobile-sheet-view mobile-sheet-list">
            <div class="git-commit-detail-body"></div>
          </div>
        </div>`);
      },
      setBodyHtml: setGitPanelBodyHtml,
      loadingHtml: `<div class="mobile-sheet-list"><div class="git-commit-file-empty sheet-list-empty inline-loading-row">${loadingIndicatorHtml()}</div></div>`,
      errorHtml: (message) => `<div class="mobile-sheet-list"><div class="git-commit-file-empty sheet-list-empty error">${escapeHtml(message)}</div></div>`,
      emptyCommitsHtml: '<div class="git-commit-file-empty sheet-list-empty" data-git-empty="1">No commits</div>',
      loadMoreLoadingHtml: loadingIndicatorHtml(),
      loadMoreRetryText: "Retry loading commits",
      loadMoreCountText: (loaded, total) => `Load more commits (${loaded}/${total})`,
      onLoadReset: () => {
        setGitSheetTitle();
        hideGitWorktreeSummary();
      },
      onCloseDetail: resetGitDetailChrome,
      onOpenDetail: setGitDetailChrome,
      onFingerprintChanged: (data) => {
        const previous = gitCountSnapshot(gitWorktreeSummaryBtn());
        renderGitWorktreeSummary(data || {});
        animateGitCountsFromSnapshot(gitWorktreeSummaryBtn(), previous);
        return { updateList: true };
      },
    });
    const updateGitPanel = async () => {
      if (!gitPanel) return;
      if (gitSession.hasShell()) {
        try {
          await gitSession.refresh();
        } catch (_) { }
        return;
      }
      await gitSession.loadPage({ reset: true });
    };
    gitPanel?.addEventListener("click", (event) => {
      void gitSession.handleClick(event, {
        onFileRow: async (fileRow) => {
          const path = String(fileRow.dataset.path || "").trim();
          if (!path) return;
          await openGitPreview(path, extFromPath(path));
        },
      });
    });
