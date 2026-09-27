    const _fileExistenceCache = new Map();
    const FILE_PREVIEW_MODE_ICONS = {
      web: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"></rect><path d="M3.5 9.5h17"></path><circle cx="7.5" cy="7" r="0.8" fill="currentColor" stroke="none"></circle><circle cx="10.5" cy="7" r="0.8" fill="currentColor" stroke="none"></circle><path d="M9.5 13.5h6"></path><path d="M9.5 16.5h4"></path>',
      text: '<path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5z"></path><path d="M14 3.5V8.5H19"></path><path d="M9 12.5h6"></path><path d="M9 16h6"></path>',
    };
    let repoPreviewBaseTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    let repoPreviewMode = "text";
    let repoPreviewControlsWired = false;
    let filePreviewLoadSeq = 0;
    let cancelFilePreviewLoading = () => {};
    const currentFileModalBaseTheme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const hasPreviewModes = (ext) => ext === "html" || ext === "htm" || ext === "md";
    const defaultPreviewMode = (ext) => ext === "md" ? "web" : "text";
    const sheetPreviewFrameEl = () => mobileSheet?.querySelector(".sheet-preview-frame");
    const repoPreviewModeBtn = () => document.querySelector(".repo-preview-mode");
    const repoPreviewModeIcon = () => document.querySelector(".repo-preview-mode-icon");
    const repoPreviewShareBtn = () => document.querySelector(".repo-preview-share");
    const sheetPreviewOpen = () => !!mobileSheet?.classList.contains("sheet-mode-preview");
    const repoPreviewExt = () => String(mobileSheet?._previewExt || "").toLowerCase();
    const syncRepoPreviewControls = () => {
      const shareBtn = repoPreviewShareBtn();
      if (shareBtn) shareBtn.hidden = !sheetPreviewOpen();
      const btn = repoPreviewModeBtn();
      const icon = repoPreviewModeIcon();
      if (!btn || !icon) return;
      btn.hidden = !sheetPreviewOpen() || !hasPreviewModes(repoPreviewExt());
      if (btn.hidden) return;
      const nextMode = repoPreviewMode === "text" ? "web" : "text";
      const title = nextMode === "text" ? "Show source" : "Show rendered";
      btn.title = title;
      btn.setAttribute("aria-label", title);
      icon.innerHTML = FILE_PREVIEW_MODE_ICONS[nextMode] || FILE_PREVIEW_MODE_ICONS.text;
    };
    const resetRepoPreviewControls = () => {
      repoPreviewBaseTheme = currentFileModalBaseTheme();
      repoPreviewMode = defaultPreviewMode(repoPreviewExt());
      syncRepoPreviewControls();
    };
    const initRepoPreviewControls = () => {
      repoPreviewBaseTheme = currentFileModalBaseTheme();
      repoPreviewMode = defaultPreviewMode(repoPreviewExt());
      syncRepoPreviewControls();
    };
    const applyPreviewModeToFrame = (frame, ext, mode) => {
      if (!hasPreviewModes(ext)) return false;
      const nextMode = mode === "text" ? "text" : "web";
      try {
        const frameWindow = frame.contentWindow;
        const frameDoc = frame.contentDocument || frameWindow?.document || null;
        if (typeof frameWindow?.__agentIndexApplyPreviewMode === "function") {
          frameWindow.__agentIndexApplyPreviewMode(nextMode);
          return true;
        }
        if (frameDoc?.documentElement) {
          frameDoc.documentElement.setAttribute("data-preview-mode", nextMode);
          return true;
        }
      } catch (_) { }
      return false;
    };
    const postPreviewModeToFrame = (frame, ext, mode) => {
      if (!frame || !hasPreviewModes(ext)) return;
      applyPreviewModeToFrame(frame, ext, mode);
      frame.contentWindow?.postMessage(
        { type: "file-preview-mode", mode },
        window.location.origin,
      );
      requestAnimationFrame(() => {
        applyPreviewModeToFrame(frame, ext, mode);
      });
      setTimeout(() => {
        applyPreviewModeToFrame(frame, ext, mode);
      }, 60);
    };
    const postRepoPreviewTheme = () => {
      const frame = sheetPreviewFrameEl();
      if (!frame?.src) return;
      postPreviewThemeToFrame(frame, repoPreviewExt(), repoPreviewBaseTheme);
    };
    const postRepoPreviewMode = () => {
      const frame = sheetPreviewFrameEl();
      if (!frame?.src) return;
      postPreviewModeToFrame(frame, repoPreviewExt(), repoPreviewMode);
    };
    const wireRepoPreviewControls = (sheetFooter) => {
      if (repoPreviewControlsWired || !sheetFooter) return;
      const closeBtn = sheetFooter.querySelector(".mobile-bottom-sheet-close");
      if (!closeBtn) return;
      repoPreviewControlsWired = true;
      const modeBtn = document.createElement("button");
      modeBtn.type = "button";
      modeBtn.className = "repo-preview-mode mobile-bottom-sheet-button";
      modeBtn.hidden = true;
      modeBtn.innerHTML = '<svg class="repo-preview-mode-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></svg>';
      sheetFooter.insertBefore(modeBtn, closeBtn);
      const shareBtn = document.createElement("button");
      shareBtn.type = "button";
      shareBtn.className = "repo-preview-share mobile-bottom-sheet-button";
      shareBtn.hidden = true;
      shareBtn.setAttribute("aria-label", "Share");
      shareBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12v4.5a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3V12"></path><path d="M12 3.5v11"></path><path d="m8 7.5 4-4 4 4"></path></svg>';
      sheetFooter.appendChild(shareBtn);
      modeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!hasPreviewModes(repoPreviewExt())) return;
        repoPreviewMode = repoPreviewMode === "text" ? "web" : "text";
        syncRepoPreviewControls();
        postRepoPreviewMode();
      });
      shareBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const path = mobileSheet?._previewPath;
        if (!path) return;
        try {
          const res = await fetch(`/file-raw?path=${encodeURIComponent(path)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          await navigator.share({ files: [new File([blob], displayAttachmentFilename(path), { type: blob.type })] });
        } catch (err) {
          if (err?.name !== "AbortError") setStatus(`Share failed: ${err?.message || err}`);
        }
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
        style.textContent = `:root{--body-weight:${bodyWeight};--file-preview-code-weight:${codeWeight};--preview-gutter-bg:rgba(${fgRgb},0.06);--preview-gutter-divider:rgba(${fgRgb},0.16)}html,body{color-scheme:${scheme};background:${bg};color:${fg}}.view-container,.html-preview-shell,.wrap{background:${bg}}.fn{color:${fg}}.code-gutter-table .ln,.preview-text-gutter-table .ln{color:${lnFg}}.code-table,.preview-text-table,pre{color:${fg}}`;
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
          { ignore: ".table-scroll, .katex-display, pre, .code-scroll, .preview-text-scroll" },
        );
        repoPreviewBaseTheme = currentFileModalBaseTheme();
        postPreviewThemeToFrame(frame, normalizedExt, repoPreviewBaseTheme);
        postPreviewModeToFrame(frame, normalizedExt, repoPreviewMode);
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
