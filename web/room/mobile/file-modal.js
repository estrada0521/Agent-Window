    const _fileExistenceCache = new Map();
    const FILE_PREVIEW_HTML_MODE_ICONS = {
      web: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"></rect><path d="M3.5 9.5h17"></path><circle cx="7.5" cy="7" r="0.8" fill="currentColor" stroke="none"></circle><circle cx="10.5" cy="7" r="0.8" fill="currentColor" stroke="none"></circle><path d="M9.5 13.5h6"></path><path d="M9.5 16.5h4"></path>',
      text: '<path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5z"></path><path d="M14 3.5V8.5H19"></path><path d="M9 12.5h6"></path><path d="M9 16h6"></path>',
    };
    let repoPreviewBaseTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    let repoHtmlPreviewMode = "text";
    let repoPreviewControlsWired = false;
    let filePreviewLoadSeq = 0;
    let cancelFilePreviewLoading = () => {};
    const currentFileModalBaseTheme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const isHtmlPreviewExt = (ext) => ext === "html" || ext === "htm";
    const sheetPreviewFrameEl = () => mobileSheet?.querySelector(".sheet-preview-frame");
    const repoPreviewHtmlModeBtn = () => document.querySelector(".repo-preview-html-mode");
    const repoPreviewHtmlModeIcon = () => document.querySelector(".repo-preview-html-mode-icon");
    const sheetPreviewOpen = () => !!mobileSheet?.classList.contains("sheet-mode-preview");
    const repoPreviewExt = () => String(mobileSheet?._previewExt || "").toLowerCase();
    const syncRepoPreviewHtmlModeToggle = () => {
      const btn = repoPreviewHtmlModeBtn();
      const icon = repoPreviewHtmlModeIcon();
      if (!btn || !icon) return;
      const isHtml = isHtmlPreviewExt(repoPreviewExt());
      btn.hidden = !sheetPreviewOpen() || !isHtml;
      if (btn.hidden) return;
      const nextMode = repoHtmlPreviewMode === "text" ? "web" : "text";
      const title = nextMode === "text" ? "Switch HTML preview to text" : "Switch HTML preview to web";
      btn.title = title;
      btn.setAttribute("aria-label", title);
      icon.innerHTML = FILE_PREVIEW_HTML_MODE_ICONS[nextMode] || FILE_PREVIEW_HTML_MODE_ICONS.text;
    };
    const resetRepoPreviewControls = () => {
      repoPreviewBaseTheme = currentFileModalBaseTheme();
      repoHtmlPreviewMode = "text";
      syncRepoPreviewHtmlModeToggle();
    };
    const initRepoPreviewControls = () => {
      repoPreviewBaseTheme = currentFileModalBaseTheme();
      repoHtmlPreviewMode = "text";
      syncRepoPreviewHtmlModeToggle();
    };
    const applyPreviewHtmlModeToFrame = (frame, ext, mode) => {
      if (!isHtmlPreviewExt(ext)) return false;
      const nextMode = mode === "text" ? "text" : "web";
      try {
        const frameWindow = frame.contentWindow;
        const frameDoc = frame.contentDocument || frameWindow?.document || null;
        if (typeof frameWindow?.__agentIndexApplyHtmlPreviewMode === "function") {
          frameWindow.__agentIndexApplyHtmlPreviewMode(nextMode);
          return true;
        }
        if (frameDoc?.documentElement) {
          frameDoc.documentElement.setAttribute("data-preview-mode", nextMode);
          return true;
        }
      } catch (_) { }
      return false;
    };
    const postPreviewHtmlModeToFrame = (frame, ext, mode) => {
      if (!frame || !isHtmlPreviewExt(ext)) return;
      applyPreviewHtmlModeToFrame(frame, ext, mode);
      frame.contentWindow?.postMessage(
        { type: "file-preview-mode", mode },
        window.location.origin,
      );
      requestAnimationFrame(() => {
        applyPreviewHtmlModeToFrame(frame, ext, mode);
      });
      setTimeout(() => {
        applyPreviewHtmlModeToFrame(frame, ext, mode);
      }, 60);
    };
    const postRepoPreviewTheme = () => {
      const frame = sheetPreviewFrameEl();
      if (!frame?.src) return;
      postPreviewThemeToFrame(frame, repoPreviewExt(), repoPreviewBaseTheme);
    };
    const postRepoPreviewHtmlMode = () => {
      const frame = sheetPreviewFrameEl();
      if (!frame?.src) return;
      postPreviewHtmlModeToFrame(frame, repoPreviewExt(), repoHtmlPreviewMode);
    };
    const wireRepoPreviewControls = (sheetFooter) => {
      if (repoPreviewControlsWired || !sheetFooter) return;
      const closeBtn = sheetFooter.querySelector(".mobile-bottom-sheet-close");
      if (!closeBtn) return;
      repoPreviewControlsWired = true;
      const htmlBtn = document.createElement("button");
      htmlBtn.type = "button";
      htmlBtn.className = "repo-preview-html-mode mobile-bottom-sheet-button";
      htmlBtn.hidden = true;
      htmlBtn.innerHTML = '<svg class="repo-preview-html-mode-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></svg>';
      sheetFooter.insertBefore(htmlBtn, closeBtn);
      htmlBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!isHtmlPreviewExt(repoPreviewExt())) return;
        repoHtmlPreviewMode = repoHtmlPreviewMode === "text" ? "web" : "text";
        syncRepoPreviewHtmlModeToggle();
        postRepoPreviewHtmlMode();
      });
      resetRepoPreviewControls();
    };
    const applyPreviewThemeToFrame = (frame, ext, baseTheme) => {
      if (!frame) return false;
      const normalizedExt = String(ext || "").toLowerCase();
      const resolvedBaseTheme = baseTheme === "light" ? "light" : "dark";
      try {
        const frameWindow = frame.contentWindow;
        const frameDoc = frame.contentDocument || frameWindow?.document || null;
        const rootStyle = getComputedStyle(document.documentElement);
        const bgRgb = rootStyle.getPropertyValue("--bg-rgb").trim();
        const bg = `rgb(${bgRgb})`;
        const bodyWeight = rootStyle.getPropertyValue("--body-weight").trim();
        const codeWeight = rootStyle.getPropertyValue("--file-preview-code-weight").trim();
        frameDoc?.documentElement?.style.setProperty("--body-weight", bodyWeight);
        frameDoc?.documentElement?.style.setProperty("--file-preview-code-weight", codeWeight);
        if (normalizedExt === "md" && typeof frameWindow?.__agentIndexApplyPreviewTheme === "function") {
          frameWindow.__agentIndexApplyPreviewTheme(resolvedBaseTheme, resolvedBaseTheme);
          frameDoc?.documentElement?.style.setProperty("--bg-rgb", bgRgb);
          frameDoc?.documentElement?.style.setProperty("--bg", bg);
          return true;
        }
        if (!frameDoc?.documentElement) return false;
        if (normalizedExt === "md") {
          frameDoc.documentElement.setAttribute(
            "data-preview-theme",
            resolvedBaseTheme,
          );
          frameDoc.documentElement.removeAttribute("data-preview-explicit-bg");
          frameDoc.documentElement.style.setProperty("--bg-rgb", bgRgb);
          frameDoc.documentElement.style.setProperty("--bg", bg);
          return true;
        }
        const isLight = resolvedBaseTheme === "light";
        const rootFgStyle = getComputedStyle(document.documentElement);
        const darkFgRgb = rootFgStyle.getPropertyValue("--dark-fg-rgb").trim() || "249, 249, 247";
        const lightFgRgb = rootFgStyle.getPropertyValue("--light-fg-rgb").trim() || "19, 19, 19";
        const darkMutedRgb = rootFgStyle.getPropertyValue("--dark-muted-rgb").trim() || "150, 150, 150";
        const lightMutedRgb = rootFgStyle.getPropertyValue("--light-muted-rgb").trim() || "120, 120, 120";
        const fgRgb = isLight ? lightFgRgb : darkFgRgb;
        const fg = `rgb(${fgRgb})`;
        const lnFg = `rgb(${isLight ? lightMutedRgb : darkMutedRgb})`;
        const scheme = isLight ? "light" : "dark";
        frameDoc.documentElement.setAttribute("data-preview-base-theme", scheme);
        let style = frameDoc.getElementById("base-theme-style");
        if (!style) {
          style = frameDoc.createElement("style");
          style.id = "base-theme-style";
          frameDoc.head?.appendChild(style);
        }
        style.textContent = `:root{--body-weight:${bodyWeight};--file-preview-code-weight:${codeWeight};--preview-gutter-bg:rgba(${fgRgb},0.06);--preview-gutter-divider:rgba(${fgRgb},0.16)}html,body{color-scheme:${scheme};background:${bg};color:${fg}}.view-container,.html-preview-shell,.wrap{background:${bg}}.fn{color:${fg}}.code-gutter-table .ln,.html-preview-gutter-table .ln{color:${lnFg}}.code-table,.html-preview-text-table,pre{color:${fg}}`;
        return true;
      } catch (_) { }
      return false;
    };
    const postPreviewThemeToFrame = (frame, ext, baseTheme) => {
      applyPreviewThemeToFrame(frame, ext, baseTheme);
      frame.contentWindow?.postMessage(
        { type: "file-preview-theme", theme: baseTheme, baseTheme },
        window.location.origin,
      );
      requestAnimationFrame(() => {
        applyPreviewThemeToFrame(frame, ext, baseTheme);
      });
      setTimeout(() => {
        applyPreviewThemeToFrame(frame, ext, baseTheme, baseTheme);
      }, 60);
    };
    const filePreviewViewEl = (frame) => frame?.closest(".sheet-preview-view") || frame?.parentElement;
    const hideFilePreviewLoading = (view) => {
      view?.querySelector(":scope > .sheet-preview-loading")?.remove();
    };
    const stopFilePreviewLoading = (frame) => {
      filePreviewLoadSeq += 1;
      cancelFilePreviewLoading();
      cancelFilePreviewLoading = () => {};
      hideFilePreviewLoading(filePreviewViewEl(frame));
    };
    const resetEmbeddedFilePreviewFrame = (frame) => {
      stopFilePreviewLoading(frame);
      if (!frame) return;
      frame.onload = null;
      frame.style.opacity = "";
      frame.style.transition = "";
      frame.removeAttribute("src");
    };
    const wireEmbeddedFilePreviewFrame = (frame, path, ext) => {
      const normalizedPath = String(path || "").trim();
      const normalizedExt = String(ext || "").toLowerCase();
      if (!frame || !normalizedPath) return;
      resetEmbeddedFilePreviewFrame(frame);
      const view = filePreviewViewEl(frame);
      const loadSeq = ++filePreviewLoadSeq;
      cancelFilePreviewLoading = startDelayedLoading(() => {
        if (loadSeq !== filePreviewLoadSeq || !view) return;
        if (view.querySelector(":scope > .sheet-preview-loading")) return;
        const node = document.createElement("div");
        node.className = "sheet-preview-loading";
        node.innerHTML = loadingIndicatorHtml();
        view.appendChild(node);
      }, () => loadSeq !== filePreviewLoadSeq);
      frame.style.opacity = "0";
      frame.onload = () => {
        cancelFilePreviewLoading();
        hideFilePreviewLoading(view);
        frame.style.transition = "opacity 200ms ease-out";
        frame.style.opacity = "1";
        if (normalizedExt === "md") {
          frame.contentDocument.addEventListener("click", (event) => {
            const anchor = event.target.closest?.("a[href]");
            if (!anchor || anchor.classList.contains("local-file-link")) return;
            const href = anchor.getAttribute("href");
            if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
            event.preventDefault();
            event.stopPropagation();
            void openExternalLink(href).catch(reportExternalLinkFailure);
          }, true);
        }
        wireMobileSheetSwipeBack(
          frame.contentDocument,
          () => sheetPreviewOpen(),
          () => popSheetPreview(),
          { ignore: ".table-scroll, .katex-display, pre, .code-scroll, .html-preview-text-scroll" },
        );
        blockHistoryEdgeSwipe(frame.contentDocument);
        repoPreviewBaseTheme = currentFileModalBaseTheme();
        postPreviewThemeToFrame(frame, normalizedExt, repoPreviewBaseTheme);
        postPreviewHtmlModeToFrame(frame, normalizedExt, repoHtmlPreviewMode);
      };
      frame.src = fileViewHrefForPath(normalizedPath, { embed: true });
    };
    const filePathFromLinkAnchor = (anchor) => {
      if (!anchor) return "";
      const fromDataset = String(anchor.dataset?.filepath || "").trim();
      if (fromDataset) return fromDataset;
      return pathFromLocalHref(anchor.getAttribute("href") || "");
    };
    const fileExistsOnDisk = async (path) => {
      const normalizedPath = String(path || "").trim();
      if (!normalizedPath) return false;
      const cached = _fileExistenceCache.get(normalizedPath);
      try {
        const res = await fetch("/files-exist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: [normalizedPath] }),
        });
        if (!res.ok) return false;
        const data = await res.json().catch(() => ({}));
        const exists = !!data?.[normalizedPath];
        _fileExistenceCache.set(normalizedPath, exists);
        return exists;
      } catch (_) {
        return cached === true;
      }
    };
    const openFileSurface = async (path, ext, sourceEl, triggerEvent) => {
      const normalizedPath = String(path || "").trim();
      if (!normalizedPath) return;
      const normalizedExt = String(ext || extFromPath(normalizedPath) || "").toLowerCase();
      await openSheetPreview(normalizedPath, normalizedExt, { kind: "repo" });
    };
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (sheetPreviewOpen()) {
        event.preventDefault();
        closeSheetPreview();
      }
    });
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver((mutations) => {
        if (!sheetPreviewOpen()) return;
        if (!mutations.some((mutation) => mutation.attributeName === "data-theme")) return;
        repoPreviewBaseTheme = currentFileModalBaseTheme();
        postRepoPreviewTheme();
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }
    const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
