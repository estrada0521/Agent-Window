    const gitCountsHtml = (ins, dels) => {
      const safeIns = Math.max(0, parseInt(ins) || 0);
      const safeDels = Math.max(0, parseInt(dels) || 0);
      const cleanClass = (safeIns || safeDels) ? "" : " clean";
      return `<span class="git-summary-counts${cleanClass}"><span class="git-summary-count ins" data-count-prefix="+" data-count-value="${safeIns}">+${safeIns}</span><span class="git-summary-count del" data-count-prefix="-" data-count-value="${safeDels}">-${safeDels}</span></span>`;
    };
    const gitPathCountText = (count) => {
      const safeCount = Math.max(0, parseInt(count) || 0);
      return `${safeCount} ${safeCount === 1 ? "path" : "paths"}`;
    };
    const gitCommitChevronSvg = '<svg class="git-commit-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
    const gitSummaryRowHtml = (data, { leadingHtml = "" } = {}) => {
      const changedPaths = Math.max(0, parseInt(data?.worktree_changed_paths) || 0);
      const worktreeAdded = Math.max(0, parseInt(data?.worktree_added) || 0);
      const worktreeDeleted = Math.max(0, parseInt(data?.worktree_deleted) || 0);
      const worktreeClickable = !!data?.worktree_has_diff;
      const worktreeLabel = changedPaths ? "Uncommitted changes" : "Working tree clean";
      const worktreeMeta = changedPaths
        ? `<span class="git-summary-meta-text">${gitPathCountText(changedPaths)}</span>`
        : `<span class="git-summary-meta-text">No changes</span>`;
      const worktreeCounts = gitCountsHtml(worktreeAdded, worktreeDeleted);
      const chevron = worktreeClickable ? gitCommitChevronSvg : "";
      return `<div class="git-summary-row${worktreeClickable ? " clickable" : ""}"${worktreeClickable ? ' data-diff-kind="worktree"' : ""}>${leadingHtml}<div class="git-commit-info"><div class="git-summary-label">${escapeHtml(worktreeLabel)}</div><div class="git-commit-meta">${worktreeMeta}${worktreeCounts}</div></div>${chevron}</div>`;
    };
    const gitCommitFileListHtml = (files, rowOptions = {}) =>
      `<div class="git-commit-file-list">${(files || []).map((entry) => gitCommitFileRowHtml(entry, rowOptions)).join("")}</div>`;
    const gitCommitFileStatsSectionHtml = (section, rowOptions = {}) =>
      `<section class="git-commit-file-section" data-scope="${escapeHtml(section.kind)}"><div class="git-commit-file-section-title">${escapeHtml(section.title)}</div>${gitCommitFileListHtml(section.files, { ...rowOptions, scope: section.kind })}</section>`;
    const gitCommitFileStatsSectionsHtml = (sections, rowOptions = {}) =>
      `<div class="git-commit-file-sections">${(sections || []).map((section) => gitCommitFileStatsSectionHtml(section, rowOptions)).join("")}</div>`;
    const gitCommitRowHtml = (commit, { animate = false } = {}) => {
      const dotClass = commit?.is_origin_main ? "git-commit-dot is-origin-main" : "git-commit-dot";
      const iconInner = `<span class="${dotClass}" aria-hidden="true"></span>`;
      const subjHtml = `<div class="git-commit-subject">${escapeHtml(commit?.subject || "")}</div>`;
      const ins = Math.max(0, parseInt(commit?.ins) || 0);
      const dels = Math.max(0, parseInt(commit?.dels) || 0);
      const animClass = animate ? " new-commit-slide" : "";
      return `<div class="git-commit-row${animClass}" data-hash="${escapeHtml(commit?.hash || "")}"><span class="git-commit-icon-wrap">${iconInner}</span><div class="git-commit-info">${subjHtml}<div class="git-commit-meta">${gitCountsHtml(ins, dels)}</div></div></div>`;
    };
    const gitCommitFileRowHtml = (entry, { animate = false } = {}) => {
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
      const fileMetaHtml = isUntracked ? "" : `<div class="git-commit-file-meta">${gitCountsHtml(ins, dels)}</div>`;
      const actionsHtml = fileMetaHtml ? `<div class="git-commit-file-actions">${fileMetaHtml}</div>` : "";
      const animClass = animate ? " new-file-slide" : "";
      const untrackedAttr = isUntracked ? ' data-untracked="1"' : "";
      return `<div class="git-commit-file-row clickable${animClass}" data-path="${escapeHtml(path)}"${untrackedAttr}><div class="git-commit-file-header">${iconHtml}<div class="git-commit-file-path" title="${escapeHtml(path)}">${pathHtml}</div>${actionsHtml}</div></div>`;
    };
    const shouldAnimateGitCounts = () =>
      !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const gitCountSnapshot = (root) =>
      root
        ? Array.from(root.querySelectorAll(".git-summary-row .git-summary-count"))
            .map((el) => Math.max(0, parseInt(el.dataset.countValue || el.textContent || "0") || 0))
        : [];
    const alignGitCountDigits = (from, to) => {
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
    const visibleGitCountRollColumns = (cols, to) => {
      const toNum = Math.max(0, parseInt(to) || 0);
      if (!cols.length) return cols;
      if (toNum === 0) {
        const firstNonZero = cols.findIndex((col) => col.start !== 0);
        return [cols[firstNonZero >= 0 ? firstNonZero : cols.length - 1]];
      }
      const toLen = String(toNum).length;
      return cols.slice(-Math.min(cols.length, toLen));
    };
    const buildGitCountRollHtml = (prefix, columns) => {
      const digitHtml = columns.map(({ start }) => {
        const items = Array.from({ length: 10 }, (_, d) =>
          `<span class="git-count-roll-item">${d}</span>`
        ).join("");
        return `<span class="git-count-roll-digit"><span class="git-count-roll-strip" style="transform:translateY(calc(${start} * -1.2em))">${items}</span></span>`;
      }).join("");
      return `<span class="git-count-roll"><span class="git-count-roll-prefix">${prefix}</span><span class="git-count-roll-digits">${digitHtml}</span></span>`;
    };
    const animateGitCount = (el, fromValue, toValue) => {
      const prefix = el.dataset.countPrefix || "";
      const from = Math.max(0, parseInt(fromValue) || 0);
      const to = Math.max(0, parseInt(toValue) || 0);
      if (!shouldAnimateGitCounts() || from === to) {
        el.textContent = `${prefix}${to}`;
        return;
      }
      const columns = visibleGitCountRollColumns(alignGitCountDigits(from, to), to);
      if (!columns.length || columns.every((col) => col.start === col.end)) {
        el.textContent = `${prefix}${to}`;
        return;
      }
      const durationMs = 900;
      const staggerMs = 70;
      el.innerHTML = buildGitCountRollHtml(prefix, columns);
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
    const animateGitCountsFromSnapshot = (root, previous) => {
      if (!root || !previous?.length) return;
      root.querySelectorAll(".git-summary-row .git-summary-count").forEach((el, idx) => {
        if (idx >= previous.length) return;
        animateGitCount(el, previous[idx], el.dataset.countValue || el.textContent || "0");
      });
    };
