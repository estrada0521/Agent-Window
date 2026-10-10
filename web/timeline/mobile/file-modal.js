    const _fileExistenceCache = new Map();
    let repoPreviewBaseTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    let repoPreviewMode = "text";
    let repoPreviewControlsWired = false;
    let filePreviewLoadSeq = 0;
    let cancelFilePreviewLoading = () => {};
    let pendingPathCopy = null;
    const cancelPendingPathCopy = () => {
      pendingPathCopy?.reject(new DOMException("Cancelled", "AbortError"));
      pendingPathCopy = null;
    };
    const currentFileModalBaseTheme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const hasPreviewModes = (ext) => ext === "html" || ext === "htm" || ext === "md";
    const defaultPreviewMode = (ext) => ext === "md" ? "web" : "text";
    const sheetPreviewFrameEl = () => mobileSheet?.querySelector(".sheet-preview-frame");
    const repoPreviewMenuBtn = () => document.querySelector(".repo-preview-menu");
    const repoPreviewShareBtn = () => document.querySelector(".repo-preview-share");
    const sheetPreviewOpen = () => !!mobileSheet?.classList.contains("sheet-mode-preview");
    const repoPreviewExt = () => String(mobileSheet?._previewExt || "").toLowerCase();
    const syncRepoPreviewControls = () => {
      const shareBtn = repoPreviewShareBtn();
      if (shareBtn) shareBtn.hidden = !sheetPreviewOpen();
      const menuBtn = repoPreviewMenuBtn();
      if (menuBtn) menuBtn.hidden = !sheetPreviewOpen() || !repoPreviewMenuItems().length;
      const ext = repoPreviewExt();
      mobileSheet?.classList.toggle("sheet-preview-glass", sheetPreviewOpen() && (ext === "html" || ext === "htm") && repoPreviewMode === "web");
    };
    const repoPreviewMenuItems = () => {
      const items = [];
      if (hasPreviewModes(repoPreviewExt())) {
        items.push(["mode", repoPreviewMode === "text" ? "Show Rendered" : "Show Source"]);
      }
      items.push(["copyAbsolutePath", "Copy Absolute Path"], ["copyRelativePath", "Copy Relative Path"]);
      return items;
    };
    const repoPreviewSharesText = () => hasPreviewModes(repoPreviewExt())
      ? repoPreviewMode === "text"
      : !!sheetPreviewFrameEl()?.contentDocument?.querySelector(".code-table");
    const resetRepoPreviewControls = () => {
      cancelPendingPathCopy();
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
      const shareBtn = document.createElement("button");
      shareBtn.type = "button";
      shareBtn.className = "repo-preview-share mobile-bottom-sheet-button";
      shareBtn.hidden = true;
      shareBtn.setAttribute("aria-label", "Share");
      shareBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12v4.5a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3V12"></path><path d="M12 3.5v11"></path><path d="m8 7.5 4-4 4 4"></path></svg>';
      sheetFooter.appendChild(shareBtn);
      const menuBtn = document.createElement("button");
      menuBtn.type = "button";
      menuBtn.className = "repo-preview-menu mobile-bottom-sheet-button";
      menuBtn.hidden = true;
      menuBtn.setAttribute("aria-label", "Menu");
      menuBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="18.5" cy="12" r="1.6"></circle></svg>';
      sheetFooter.insertBefore(menuBtn, shareBtn);
      const menuSelect = document.createElement("select");
      menuSelect.className = "hub-native-menu-select is-ios-active";
      menuSelect.setAttribute("aria-label", "Menu");
      document.body.appendChild(menuSelect);
      menuBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const items = repoPreviewMenuItems();
        if (!items.length) return;
        menuSelect.innerHTML = '<option value="" disabled selected>Menu</option>' + items.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
        const rect = menuBtn.getBoundingClientRect();
        const headerRect = rightMenuBtn.getBoundingClientRect();
        menuSelect.style.left = `${Math.round(rect.left)}px`;
        menuSelect.style.top = `${Math.round(headerRect.top)}px`;
        menuSelect.style.width = `${Math.round(rect.width)}px`;
        menuSelect.style.height = `${Math.round(headerRect.height)}px`;
        menuSelect.value = "";
        cancelPendingPathCopy();
        const copy = { path: mobileSheet._previewPath };
        const content = new Promise((resolve, reject) => {
          copy.resolve = resolve;
          copy.reject = reject;
        });
        pendingPathCopy = copy;
        try {
          copy.result = navigator.clipboard.write([new ClipboardItem({ "text/plain": content })])
            .then(() => null, (error) => error);
        } catch (error) {
          copy.result = Promise.resolve(error);
          content.catch(() => {});
        }
        openNativeSelect(menuSelect);
      });
      menuSelect.addEventListener("change", async () => {
        const action = menuSelect.value;
        menuSelect.value = "";
        if (action === "copyAbsolutePath" || action === "copyRelativePath") {
          const copy = pendingPathCopy;
          pendingPathCopy = null;
          try {
            const response = await fetchWithTimeout("/timeline-state", {}, 4000);
            if (!response.ok) throw new Error("Failed to read workspace path");
            const state = await response.json();
            const root = state.workspace.replace(/\/+$/, "");
            const path = copy.path;
            const text = action === "copyAbsolutePath"
              ? (path.startsWith("/") ? path : `${root}/${path}`)
              : (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path);
            copy.resolve(new Blob([`\`${text}\``], { type: "text/plain" }));
            const error = await copy.result;
            if (error) throw error;
            setStatus(action === "copyAbsolutePath" ? "Copied absolute path" : "Copied relative path");
          } catch (error) {
            copy.reject(error);
            setError("Copy failed", error);
          }
          return;
        }
        cancelPendingPathCopy();
        if (action === "mode") {
          repoPreviewMode = repoPreviewMode === "text" ? "web" : "text";
          syncRepoPreviewControls();
          postRepoPreviewMode();
        }
      });
      shareBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const path = mobileSheet?._previewPath;
        if (!path) return;
        try {
          const res = await fetch(`/file-raw?path=${encodeURIComponent(path)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (repoPreviewSharesText()) {
            await navigator.share({ text: await res.text() });
          } else {
            const blob = await res.blob();
            await navigator.share({ files: [new File([blob], displayAttachmentFilename(path), { type: blob.type })] });
          }
        } catch (err) {
          if (err?.name !== "AbortError") setError("Share failed", err);
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
        if (frameDoc?.documentElement) {
          frameDoc.documentElement.style.colorScheme = resolvedBaseTheme;
          for (const name of ["--bg-rgb", "--mobile-sheet-footer-bottom", "--mobile-sheet-floating-height"]) {
            frameDoc.documentElement.style.setProperty(name, rootStyle.getPropertyValue(name).trim());
          }
          let gutterStyle = frameDoc.getElementById("mobile-gutter-style");
          if (!gutterStyle) {
            gutterStyle = frameDoc.createElement("style");
            gutterStyle.id = "mobile-gutter-style";
            frameDoc.head.appendChild(gutterStyle);
            gutterStyle.textContent = `.view-container,.preview-text-wrap{--preview-gutter-width:var(--mobile-sheet-floating-height)}.code-gutter,.preview-text-gutter{box-sizing:border-box;position:absolute;left:14px;top:20px;bottom:calc(var(--mobile-sheet-footer-bottom) + var(--mobile-sheet-floating-height) + 8px);width:var(--preview-gutter-width);min-width:0;z-index:2;border:0.5px solid var(--preview-gutter-divider);border-radius:999px;background:linear-gradient(var(--preview-gutter-bg),var(--preview-gutter-bg)),rgba(var(--bg-rgb),0.97);padding:0}.code-gutter-inner,.preview-text-gutter-inner{position:relative;top:calc(var(--code-tpad) - 20.5px)}.code-gutter .code-gutter-table .ln,.preview-text-gutter .preview-text-gutter-table .ln{width:100%;min-width:0;padding-left:4px;padding-right:4px}.code-scroll,.preview-text-scroll{margin-left:0;padding-left:calc(var(--preview-gutter-width) + 14px);mask-image:linear-gradient(to right,transparent calc(var(--preview-gutter-width) + 14px),black calc(var(--preview-gutter-width) + 28px));-webkit-mask-image:linear-gradient(to right,transparent calc(var(--preview-gutter-width) + 14px),black calc(var(--preview-gutter-width) + 28px))}`;
          }
        }
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
        const fgRgb = isLight ? lightFgRgb : darkFgRgb;
        const fg = `rgb(${fgRgb})`;
        const lnFg = isLight ? `rgba(${lightFgRgb},0.8)` : `color-mix(in srgb, rgb(${darkMutedRgb}) 88%, white)`;
        const scheme = isLight ? "light" : "dark";
        frameDoc.documentElement.setAttribute("data-preview-base-theme", scheme);
        let style = frameDoc.getElementById("base-theme-style");
        if (!style) {
          style = frameDoc.createElement("style");
          style.id = "base-theme-style";
          frameDoc.head?.appendChild(style);
        }
        style.textContent = `:root{--body-weight:${bodyWeight};--file-preview-code-weight:${codeWeight};--preview-gutter-bg:rgba(${fgRgb},${isLight ? 0.04 : 0.09});--preview-gutter-divider:rgba(${fgRgb},${isLight ? 0.34 : 0.22})}.html-preview-web-glass{--preview-glass-rgb:${bgRgb};--preview-glass-line:rgba(${fgRgb},0.08)}html,body{background:transparent;color:${fg}}.view-container,.html-preview-shell,.wrap{background:transparent}.fn{color:${fg}}.code-gutter-table .ln,.preview-text-gutter-table .ln{color:${lnFg}}.code-table,.preview-text-table,pre{color:${fg}}`;
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
            if (!anchor || anchor.classList.contains("local-file-link") || anchor.classList.contains("inline-file-link")) return;
            const href = anchor.getAttribute("href");
            if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
            event.preventDefault();
            event.stopPropagation();
            void openExternalLink(href).catch(reportExternalLinkFailure);
          }, true);
          frame.contentDocument.addEventListener("click", (event) => {
            const image = event.target.closest?.(".md-body img");
            if (!image || image.closest("a[href]")) return;
            const path = pathFromLocalHref(image.currentSrc || image.src);
            if (!path) return;
            event.preventDefault();
            event.stopPropagation();
            void openSheetPreview(path, extFromPath(path), { kind: sheetKind() || "repo" });
          }, true);
        }
        if (normalizedExt === "html" || normalizedExt === "htm") {
          const renderedFrame = frame.contentDocument.querySelector(".html-preview-panel-web iframe");
          if (renderedFrame) {
            let linkedDocument = null;
            const wireRenderedLinks = () => {
              const doc = renderedFrame.contentDocument;
              if (!doc || doc === linkedDocument) return;
              linkedDocument = doc;
              doc.addEventListener("click", (event) => {
                const anchor = event.target.closest?.("a[href]");
                const rawHref = anchor?.getAttribute("href")?.trim() || "";
                if (!rawHref || rawHref.startsWith("#")) return;
                const href = anchor.href;
                if (anchor.protocol !== "mailto:" &&
                    !((anchor.protocol === "http:" || anchor.protocol === "https:") && anchor.origin !== window.location.origin)) return;
                event.preventDefault();
                event.stopPropagation();
                void openExternalLink(href).catch(reportExternalLinkFailure);
              }, true);
            };
            renderedFrame.addEventListener("load", wireRenderedLinks);
            wireRenderedLinks();
          }
        }
        wireMobileSheetSwipeBack(
          frame.contentDocument,
          () => sheetPreviewOpen(),
          () => popSheetPreview(),
          { ignore: ".image-surface, .table-scroll, .katex-display, pre, .code-scroll, .preview-text-scroll" },
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
