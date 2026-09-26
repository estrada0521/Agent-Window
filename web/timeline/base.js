    const openNativeSelect = (select) => {
      if (typeof select.showPicker === "function") {
        try {
          select.showPicker();
          return;
        } catch (_) {}
      }
      select.focus({ preventScroll: true });
      select.click();
    };
    const normalizeHubPath = (path) => {
      const raw = String(path || "/");
      return raw.startsWith("/") ? raw : `/${raw}`;
    };
    const TIMELINE_BASE_PATH = "__TIMELINE_BASE_PATH__";
    const TIMELINE_ASSET_BASE = TIMELINE_BASE_PATH || "";
    const withTimelineBase = (path) => {
      const raw = String(path || "");
      if (!TIMELINE_BASE_PATH || !raw.startsWith("/") || raw.startsWith("//")) return raw;
      if (raw === TIMELINE_BASE_PATH || raw.startsWith(`${TIMELINE_BASE_PATH}/`)) return raw;
      return `${TIMELINE_BASE_PATH}${raw}`;
    };
    if (TIMELINE_BASE_PATH) {
      const __origFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (typeof input === "string" && input.startsWith("/") && !input.startsWith("//")) {
          return __origFetch(withTimelineBase(input), init);
        }
        if (input instanceof Request) {
          const url = input.url || "";
          if (url.startsWith(window.location.origin + "/")) {
            const nextUrl = `${window.location.origin}${withTimelineBase(url.slice(window.location.origin.length))}`;
            return __origFetch(new Request(nextUrl, input), init);
          }
        }
        return __origFetch(input, init);
      };
    }
    const loadExternalScriptOnce = (() => {
      const pending = new Map();
      return (src) => {
        const raw = String(src || "").trim();
        if (!raw) return Promise.resolve(false);
        const href = new URL(raw, window.location.href).href;
        for (const script of document.scripts) {
          if ((script.src || "") === href) return Promise.resolve(true);
        }
        if (pending.has(href)) return pending.get(href);
        const promise = new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = href;
          script.onload = () => resolve(true);
          script.onerror = () => reject(new Error(`failed to load ${href}`));
          document.head.appendChild(script);
        }).catch(() => false);
        pending.set(href, promise);
        return promise;
      };
    })();
    const loadExternalStylesheetOnce = (() => {
      const pending = new Map();
      return (href) => {
        const raw = String(href || "").trim();
        if (!raw) return Promise.resolve(false);
        const absHref = new URL(raw, window.location.href).href;
        for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
          if ((link.href || "") === absHref) return Promise.resolve(true);
        }
        if (pending.has(absHref)) return pending.get(absHref);
        const promise = new Promise((resolve, reject) => {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = absHref;
          link.onload = () => resolve(true);
          link.onerror = () => reject(new Error(`failed to load ${absHref}`));
          document.head.appendChild(link);
        }).catch(() => false);
        pending.set(absHref, promise);
        return promise;
      };
    })();
    const KATEX_CSS_HREF = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
    const KATEX_JS_SRC = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
    const KATEX_AUTO_RENDER_SRC = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js";
__INCLUDE:file-link-parse.js__
__INCLUDE:markdown-frontmatter.js__
__INCLUDE:markdown-render.js__
__INCLUDE:file-icon-theme.js__
    const displayAttachmentFilename = (path) => {
      const filename = String(path || "").split("/").pop() || String(path || "");
      if (!/(?:^|\/)uploads\//.test(String(path || ""))) return filename;
      const match = filename.match(/^\d{8}_\d{6}_(.+)$/);
      return match ? match[1] : filename;
    };
    const normalizeWorkspaceFilePath = (p) => {
      let s = String(p || "").trim();
      if (!s) return "";
      s = s.replace(/\\/g, "/");
      for (let i = 0; i < 8; i += 1) {
        const next = s.replace("/./", "/");
        if (next === s) break;
        s = next;
      }
      for (let i = 0; i < 8; i += 1) {
        const next = s.replace("//", "/");
        if (next === s) break;
        s = next;
      }
      if (s.length > 1 && s.endsWith("/")) {
        s = s.slice(0, -1);
      }
      return s;
    };
    const LOADING_SPINNER_DELAY_MS = 500;
    const loadingIndicatorHtml = () =>
      '<span class="inline-loading"><span class="inline-loading-spinner" aria-hidden="true"></span></span>';
    const startDelayedLoading = (show, isCancelled) => {
      const timer = setTimeout(() => {
        if (isCancelled?.()) return;
        show();
      }, LOADING_SPINNER_DELAY_MS);
      return () => clearTimeout(timer);
    };
    const currentFilePreviewTextSize = () => {
      try {
        const rawSize = window.getComputedStyle(document.documentElement).getPropertyValue("--text-size") || "";
        const parsedSize = Number.parseInt(String(rawSize).trim(), 10);
        if (Number.isFinite(parsedSize) && parsedSize >= 11 && parsedSize <= 18) {
          return String(parsedSize);
        }
      } catch (_) {}
      return "";
    };
    const fileViewHrefForPath = (path, { embed = false } = {}) => {
      const params = new URLSearchParams();
      params.set("path", normalizeWorkspaceFilePath(path) || String(path || "").trim());
      if (embed) {
        params.set("embed", "1");
        params.set("progressive", "1");
      }
      if (TIMELINE_BASE_PATH) params.set("base_path", TIMELINE_BASE_PATH);
      params.set("base_theme", document.documentElement.dataset.theme === "light" ? "light" : "dark");
      const textSize = currentFilePreviewTextSize();
      if (textSize) params.set("agent_text_size", textSize);
      return withTimelineBase(`/file-view?${params.toString()}`);
    };
    const buildInlineFileLinkMarkup = (path, label = "") => {
      const normalizedPath = normalizeWorkspaceFilePath(path);
      if (!normalizedPath) return "";
      const visible = String(label || displayAttachmentFilename(normalizedPath) || normalizedPath).trim() || normalizedPath;
      const href = fileViewHrefForPath(normalizedPath);
      const iconHtml = fileIconThemeState.ready
        ? fileIconHtml(normalizedPath, { classNames: "inline-file-link-icon" })
        : "";
      return `<a class="inline-file-link" href="${escapeHtml(href)}" data-filepath="${escapeHtml(normalizedPath)}" data-ext="${escapeHtml(extFromPath(normalizedPath))}" title="${escapeHtml(normalizedPath)}">${iconHtml}<code>${escapeHtml(visible)}</code></a>`;
    };
    const injectFileCards = (html) => {
      return html
        .replace(/(^|[\s>(])@((?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?)/g, (match, prefix, rawPath) => {
          return `${prefix}${buildInlineFileLinkMarkup(rawPath, rawPath)}`;
        });
    };
