    const _fileExistenceCache = new Map();
    const FILE_PREVIEW_HTML_MODE_ICONS = {
      web: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"></rect><path d="M3.5 9.5h17"></path><circle cx="7.5" cy="7" r="0.8" fill="currentColor" stroke="none"></circle><circle cx="10.5" cy="7" r="0.8" fill="currentColor" stroke="none"></circle><path d="M9.5 13.5h6"></path><path d="M9.5 16.5h4"></path>',
      text: '<path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5z"></path><path d="M14 3.5V8.5H19"></path><path d="M9 12.5h6"></path><path d="M9 16h6"></path>',
    };
    let repoPreviewBaseTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    let repoHtmlPreviewMode = "text";
    let repoPreviewControlsWired = false;
    const currentFileModalBaseTheme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const isHtmlPreviewExt = (ext) => ext === "html" || ext === "htm";
    const repoPreviewFrameEl = () => repoPanel?.querySelector(".repo-preview-frame");
    const repoPreviewHtmlModeBtn = () => repoPanel?.querySelector(".repo-preview-html-mode");
    const repoPreviewHtmlModeIcon = () => repoPanel?.querySelector(".repo-preview-html-mode-icon");
    const repoPreviewExt = () => String(repoPanel?._previewExt || "").toLowerCase();
    const repoPreviewInPreviewMode = () => !!repoPanel?.classList.contains("repo-mode-preview");
    const syncRepoPreviewHtmlModeToggle = () => {
      const btn = repoPreviewHtmlModeBtn();
      const icon = repoPreviewHtmlModeIcon();
      if (!btn || !icon) return;
      const isHtml = isHtmlPreviewExt(repoPreviewExt());
      btn.hidden = !repoPreviewInPreviewMode() || !isHtml;
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
      try {
        frame.contentWindow?.postMessage(
          { type: "agent-index-file-preview-mode", mode },
          window.location.origin,
        );
      } catch (_) { }
      requestAnimationFrame(() => {
        applyPreviewHtmlModeToFrame(frame, ext, mode);
      });
      setTimeout(() => {
        applyPreviewHtmlModeToFrame(frame, ext, mode);
      }, 60);
    };
    const postRepoPreviewTheme = () => {
      const frame = repoPreviewFrameEl();
      if (!frame?.src) return;
      postPreviewThemeToFrame(frame, repoPreviewExt(), repoPreviewBaseTheme);
    };
    const postRepoPreviewHtmlMode = () => {
      const frame = repoPreviewFrameEl();
      if (!frame?.src) return;
      postPreviewHtmlModeToFrame(frame, repoPreviewExt(), repoHtmlPreviewMode);
    };
    const wireRepoPreviewControls = (sheetNav) => {
      if (repoPreviewControlsWired || !sheetNav) return;
      const navBar = sheetNav.querySelector(".repo-sheet-nav-bar");
      const closeBtn = navBar?.querySelector(".repo-sheet-close");
      if (!navBar || !closeBtn) return;
      repoPreviewControlsWired = true;
      const actions = document.createElement("div");
      actions.className = "repo-preview-actions";
      const htmlBtn = document.createElement("button");
      htmlBtn.type = "button";
      htmlBtn.className = "repo-preview-html-mode mobile-bottom-sheet-button";
      htmlBtn.hidden = true;
      htmlBtn.innerHTML = '<svg class="repo-preview-html-mode-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></svg>';
      actions.append(htmlBtn, closeBtn);
      navBar.appendChild(actions);
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
        const bgRgb = rootStyle.getPropertyValue("--bg-rgb").trim()
          || (resolvedBaseTheme === "light" ? "249,249,247" : "13,13,12");
        const bg = `rgb(${bgRgb})`;
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
        // Line numbers are text-muted, not a translucent tint of fg -- same
        // constant the initial server-rendered pane_ln_color reads, so this
        // live theme-toggle update can't drift from it.
        const lnFg = `rgb(${isLight ? lightMutedRgb : darkMutedRgb})`;
        const scheme = isLight ? "light" : "dark";
        frameDoc.documentElement.setAttribute("data-preview-base-theme", scheme);
        let style = frameDoc.getElementById("agent-index-base-theme-style");
        if (!style) {
          style = frameDoc.createElement("style");
          style.id = "agent-index-base-theme-style";
          frameDoc.head?.appendChild(style);
        }
        style.textContent = `:root{--body-weight:${isLight ? "430" : "300"}}html,body{color-scheme:${scheme};background:${bg};color:${fg}}.view-container,.html-preview-shell,.wrap{background:${bg}}.fn{color:${fg}}.code-gutter-table .ln,.html-preview-gutter-table .ln{color:${lnFg}}.code-table,.html-preview-text-table,pre{color:${fg}}`;
        return true;
      } catch (_) { }
      return false;
    };
    const postPreviewThemeToFrame = (frame, ext, baseTheme) => {
      applyPreviewThemeToFrame(frame, ext, baseTheme);
      try {
        frame.contentWindow?.postMessage(
          { type: "agent-index-file-preview-theme", theme: baseTheme, baseTheme },
          window.location.origin,
        );
      } catch (_) { }
      requestAnimationFrame(() => {
        applyPreviewThemeToFrame(frame, ext, baseTheme);
      });
      setTimeout(() => {
        applyPreviewThemeToFrame(frame, ext, baseTheme, baseTheme);
      }, 60);
    };
    const resetEmbeddedFilePreviewFrame = (frame) => {
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
      frame.style.opacity = "0";
      frame.onload = () => {
        frame.style.transition = "opacity 200ms ease-out";
        frame.style.opacity = "1";
        repoPreviewBaseTheme = currentFileModalBaseTheme();
        postPreviewThemeToFrame(frame, normalizedExt, repoPreviewBaseTheme);
        postPreviewHtmlModeToFrame(frame, normalizedExt, repoHtmlPreviewMode);
      };
      frame.src = fileViewHrefForPath(normalizedPath, { embed: true });
    };
__CHAT_INCLUDE:../../../shared/chat/file-link-parse.js__
    const decorateLocalFileLinks = (scope = document) => {
      if (!scope?.querySelectorAll) return;
      scope.querySelectorAll(".md-body a[href]").forEach((anchor) => {
        if (!anchor) return;
        const href = anchor.getAttribute("href") || "";
        const path = pathFromLocalHref(href);
        if (!path) return;
        anchor.classList.add("local-file-link");
        if (!anchor.dataset.filepath) anchor.dataset.filepath = path;
        if (!anchor.dataset.ext) anchor.dataset.ext = extFromPath(path);
        if (!anchor.title) anchor.title = path;
        if (!anchor.querySelector("code") && anchor.childElementCount === 0) {
          const label = document.createElement("code");
          label.textContent = anchor.textContent || path;
          anchor.replaceChildren(label);
        }
      });
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
      if (typeof repoPanel?._openFilePreview !== "function") return;
      if (!isPublicChatView) {
        const exists = await fileExistsOnDisk(normalizedPath);
        if (!exists) {
          setStatus(`file not found: ${displayAttachmentFilename(normalizedPath) || normalizedPath}`, true);
          setTimeout(() => setStatus(""), STATUS_TOAST_MS);
          return;
        }
      }
      await repoPanel._openFilePreview(normalizedPath, normalizedExt);
    };
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && repoPanel?.classList.contains("repo-mode-preview")) {
        event.preventDefault();
        closeRepoPreview();
        return;
      }
      if (event.key === "Escape" && isComposerOverlayOpen()) {
        event.preventDefault();
        closeComposerOverlay({ restoreFocus: true });
      }
    });
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver((mutations) => {
        if (!repoPanel?.classList.contains("repo-mode-preview")) return;
        if (!mutations.some((mutation) => mutation.attributeName === "data-theme")) return;
        const frame = repoPreviewFrameEl();
        if (!frame?.src) return;
        repoPreviewBaseTheme = currentFileModalBaseTheme();
        postRepoPreviewTheme();
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }
    const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
