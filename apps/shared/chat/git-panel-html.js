    const gitBranchCountsHtml = (ins, dels) => {
      const safeIns = Math.max(0, parseInt(ins) || 0);
      const safeDels = Math.max(0, parseInt(dels) || 0);
      const cleanClass = (safeIns || safeDels) ? "" : " clean";
      return `<span class="git-branch-summary-counts${cleanClass}"><span class="git-branch-summary-count ins" data-count-prefix="+" data-count-value="${safeIns}">+${safeIns}</span><span class="git-branch-summary-count del" data-count-prefix="-" data-count-value="${safeDels}">-${safeDels}</span></span>`;
    };
    const gitBranchPathCountText = (count) => {
      const safeCount = Math.max(0, parseInt(count) || 0);
      return `${safeCount} ${safeCount === 1 ? "path" : "paths"}`;
    };
    const gitCommitRowHtml = (commit, { animate = false } = {}) => {
      const dotClass = commit?.is_origin_main ? "git-commit-dot is-origin-main" : "git-commit-dot";
      const iconInner = `<span class="${dotClass}" aria-hidden="true"></span>`;
      const subjHtml = `<div class="git-commit-subject">${escapeHtml(commit?.subject || "")}</div>`;
      const ins = Math.max(0, parseInt(commit?.ins) || 0);
      const dels = Math.max(0, parseInt(commit?.dels) || 0);
      const animClass = animate ? " new-commit-slide" : "";
      return `<div class="git-commit-row${animClass}" data-hash="${escapeHtml(commit?.hash || "")}"><span class="git-commit-icon-wrap">${iconInner}</span><div class="git-commit-info">${subjHtml}<div class="git-commit-meta">${gitBranchCountsHtml(ins, dels)}</div></div></div>`;
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
      const fileMetaHtml = isUntracked ? "" : `<div class="git-commit-file-meta">${gitBranchCountsHtml(ins, dels)}</div>`;
      const actionsHtml = fileMetaHtml ? `<div class="git-commit-file-actions">${fileMetaHtml}</div>` : "";
      const animClass = animate ? " new-file-slide" : "";
      const untrackedAttr = isUntracked ? ' data-untracked="1"' : "";
      return `<div class="git-commit-file-row clickable${animClass}" data-path="${escapeHtml(path)}"${untrackedAttr}><div class="git-commit-file-header">${iconHtml}<div class="git-commit-file-path" title="${escapeHtml(path)}">${pathHtml}</div>${actionsHtml}</div></div>`;
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
