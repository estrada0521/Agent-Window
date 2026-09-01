    const STATUS_TOAST_MS = 2500;
    const normalizeHubPath = (path) => {
      const raw = String(path || "/");
      return raw.startsWith("/") ? raw : `/${raw}`;
    };
    const CHAT_BASE_PATH = "__CHAT_BASE_PATH__";
    const CHAT_ASSET_BASE = CHAT_BASE_PATH || "";
    const withChatBase = (path) => {
      const raw = String(path || "");
      if (!CHAT_BASE_PATH || !raw.startsWith("/") || raw.startsWith("//")) return raw;
      if (raw === CHAT_BASE_PATH || raw.startsWith(`${CHAT_BASE_PATH}/`)) return raw;
      return `${CHAT_BASE_PATH}${raw}`;
    };
    if (CHAT_BASE_PATH) {
      const __origFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (typeof input === "string" && input.startsWith("/") && !input.startsWith("//")) {
          return __origFetch(withChatBase(input), init);
        }
        if (input instanceof Request) {
          const url = input.url || "";
          if (url.startsWith(window.location.origin + "/")) {
            const nextUrl = `${window.location.origin}${withChatBase(url.slice(window.location.origin.length))}`;
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
    const ANSI_UP_SRC = "https://cdn.jsdelivr.net/npm/ansi_up@5.1.0/ansi_up.min.js";
    const KATEX_CSS_HREF = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
    const KATEX_JS_SRC = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
    const KATEX_AUTO_RENDER_SRC = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js";
    const normalizeEscapedLineBreaks = (text) => {
      const value = String(text ?? "");
      if (!/\\[rn]/.test(value)) return value;
      const matches = value.match(/\\r\\n|\\n|\\r/g) || [];
      if (matches.length < 2 && !/\\n\\n|\\n\s*(?:[-*]|\d+\.|#{1,6}\s)/.test(value)) return value;
      return value.replace(/\\r\\n|\\n|\\r/g, "\n");
    };
    const UNSAFE_URL_ATTR_PATTERN = /^\s*javascript:/i;
    const stripUnsafeMarkup = (root) => {
      // marked passes raw HTML through unchanged; agent output routinely
      // quotes HTML it read from the web, so this has to run on every
      // render, not just ones that look suspicious.
      root.querySelectorAll("iframe, object, embed, form").forEach(el => el.remove());
      root.querySelectorAll("*").forEach(el => {
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          if (name.startsWith("on")) {
            el.removeAttribute(attr.name);
          } else if (/^(?:href|src|xlink:href|action|formaction)$/.test(name) && UNSAFE_URL_ATTR_PATTERN.test(attr.value)) {
            el.removeAttribute(attr.name);
          }
        }
      });
    };
    const revealExternalMarkdownLinkTargets = (root) => {
      root.querySelectorAll("a[href]").forEach((anchor) => {
        if (anchor.classList.contains("inline-file-link") || anchor.classList.contains("local-file-link")) return;
        const href = String(anchor.getAttribute("href") || "").trim();
        const label = String(anchor.textContent || "").trim();
        if (!href || label === href) return;
        const target = document.createElement("span");
        target.className = "markdown-link-target";
        target.textContent = ` (${href})`;
        anchor.after(target);
      });
    };
    const applyWrittenOrderedListNumbers = (root, source) => {
      if (!root || typeof marked?.lexer !== "function") return;
      const values = [];
      const walk = (tokens) => {
        for (const token of tokens || []) {
          if (token.type === "list" && token.ordered) {
            for (const item of token.items || []) {
              const match = String(item.raw || "").match(/^\s*(\d{1,9})[.)]/);
              values.push(match ? match[1] : "");
              walk(item.tokens);
            }
          } else if (token.tokens) {
            walk(token.tokens);
          }
        }
      };
      walk(marked.lexer(String(source ?? ""), { breaks: true, gfm: true }));
      const items = root.querySelectorAll("ol > li");
      if (!values.length || values.length !== items.length) return;
      items.forEach((item, index) => {
        if (values[index]) item.setAttribute("value", values[index]);
      });
    };
    __CHAT_INCLUDE:markdown-frontmatter.js__
    const renderMarkdownFallback = (text) => escapeHtml(String(text ?? "")).replace(/\n/g, "<br>");
    const renderMarkdown = (text) => {
      try {
        return renderMarkdownUnsafe(text);
      } catch (err) {
        console.error("markdown render failed, showing plain text", err);
        return renderMarkdownFallback(text);
      }
    };
    const renderMarkdownUnsafe = (text) => {
      if (typeof marked === "undefined") {
        throw new Error("marked is unavailable");
      }
      let frontmatterHtml = "";
      let bodyText = text;
      const frontmatter = extractFrontmatter(text);
      if (frontmatter) {
        const parsed = parseSimpleFrontmatter(frontmatter.yamlText);
        if (Object.keys(parsed).length) {
          frontmatterHtml = frontmatterTableHtml(parsed);
          bodyText = frontmatter.body;
        }
      }
      text = bodyText;
      const mathBlocks = [];
      let placeholderCount = 0;

      const codeBlocks = [];
      let codeCount = 0;
      // Protect literal code and TeX before expanding serialized newlines.
      // In particular, `\\right` begins with `\\r`; normalizing first used to
      // turn it into a newline followed by `ight`, which KaTeX correctly rejects.
      let processedText = String(text ?? "").replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
        const id = `code-placeholder-${codeCount++}`;
        codeBlocks.push({ id, content: match });
        return `\x00CODE:${id}\x00`;
      });

      processedText = processedText.replace(/(\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g, (match) => {
        const id = `math-placeholder-${placeholderCount++}`;
        mathBlocks.push({ id, content: match });
        return `<span class="MATH_SAFE_BLOCK" data-id="${id}"></span>`;
      });

      processedText = normalizeEscapedLineBreaks(processedText);

      processedText = processedText.replace(/\x00CODE:(code-placeholder-\d+)\x00/g, (_, id) => {
        const block = codeBlocks.find(b => b.id === id);
        return block ? block.content : "";
      });

      let html = marked.parse(processedText, { breaks: true, gfm: true });

      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = html;
      stripUnsafeMarkup(tempDiv);
      applyWrittenOrderedListNumbers(tempDiv, processedText);
      tempDiv.querySelectorAll(".MATH_SAFE_BLOCK").forEach(span => {
        const block = mathBlocks.find(b => b.id === span.dataset.id);
        if (block) {
          span.replaceWith(document.createTextNode(block.content));
        }
      });
      if (mathBlocks.length) {
        const marker = document.createElement("span");
        marker.className = "math-render-needed";
        marker.hidden = true;
        tempDiv.prepend(marker);
      }
      const copySvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      tempDiv.querySelectorAll("pre").forEach(pre => {
        const wrap = document.createElement("div");
        wrap.className = "code-block-wrap";
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(pre);
        wrap.insertAdjacentHTML("beforeend", `<button class="code-copy-btn" title="Copy">${copySvg}</button>`);
      });

      if (frontmatterHtml) tempDiv.insertAdjacentHTML("afterbegin", frontmatterHtml);

      return injectFileCards(tempDiv.innerHTML);
    };
    const wrapFileIcon = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const FILE_SVG_ICONS = {
      image: wrapFileIcon('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
      video: wrapFileIcon('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>'),
      audio: wrapFileIcon('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
      file: wrapFileIcon('<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>'),
      code: wrapFileIcon('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
      archive: wrapFileIcon('<path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3"/><path d="m3 8 9 6 9-6"/><path d="M3 18v-8"/><path d="M21 18v-8"/><path d="M3 18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2"/>'),
      web: wrapFileIcon('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>')
    };
    const FILE_ICONS = {
      png: FILE_SVG_ICONS.image, jpg: FILE_SVG_ICONS.image, jpeg: FILE_SVG_ICONS.image, gif: FILE_SVG_ICONS.image, webp: FILE_SVG_ICONS.image, svg: FILE_SVG_ICONS.image, ico: FILE_SVG_ICONS.image,
      pdf: FILE_SVG_ICONS.file,
      mp4: FILE_SVG_ICONS.video, mov: FILE_SVG_ICONS.video, webm: FILE_SVG_ICONS.video, avi: FILE_SVG_ICONS.video, mkv: FILE_SVG_ICONS.video,
      mp3: FILE_SVG_ICONS.audio, wav: FILE_SVG_ICONS.audio, ogg: FILE_SVG_ICONS.audio, m4a: FILE_SVG_ICONS.audio, flac: FILE_SVG_ICONS.audio,
      zip: FILE_SVG_ICONS.archive, tar: FILE_SVG_ICONS.archive, gz: FILE_SVG_ICONS.archive, bz2: FILE_SVG_ICONS.archive, rar: FILE_SVG_ICONS.archive,
      md: FILE_SVG_ICONS.file, txt: FILE_SVG_ICONS.file,
      py: FILE_SVG_ICONS.code, js: FILE_SVG_ICONS.code, ts: FILE_SVG_ICONS.code, sh: FILE_SVG_ICONS.code, json: FILE_SVG_ICONS.code, yaml: FILE_SVG_ICONS.code, yml: FILE_SVG_ICONS.code,
      html: FILE_SVG_ICONS.web, css: FILE_SVG_ICONS.web,
    };
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
    const loadingIndicatorHtml = () =>
      '<span class="inline-loading"><span class="inline-loading-spinner" aria-hidden="true"></span></span>';
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
      if (CHAT_BASE_PATH) params.set("base_path", CHAT_BASE_PATH);
      params.set("base_theme", document.documentElement.dataset.theme === "light" ? "light" : "dark");
      const textSize = currentFilePreviewTextSize();
      if (textSize) params.set("agent_text_size", textSize);
      return withChatBase(`/file-view?${params.toString()}`);
    };
    const buildInlineFileLinkMarkup = (path, label = "") => {
      const normalizedPath = normalizeWorkspaceFilePath(path);
      if (!normalizedPath) return "";
      const visible = String(label || displayAttachmentFilename(normalizedPath) || normalizedPath).trim() || normalizedPath;
      const href = fileViewHrefForPath(normalizedPath);
      return `<a class="inline-file-link" href="${escapeHtml(href)}" data-filepath="${escapeHtml(normalizedPath)}" data-ext="${escapeHtml(extFromPath(normalizedPath))}" title="${escapeHtml(normalizedPath)}"><code>${escapeHtml(visible)}</code></a>`;
    };
    const injectFileCards = (html) => {
      return html
        .replace(/\[Attached:\s*([^\]]+)\]/g, (match, rawPath) => buildInlineFileLinkMarkup(rawPath.trim()))
        .replace(/(^|[\s>(])@((?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?)/g, (match, prefix, rawPath) => {
          return `${prefix}${buildInlineFileLinkMarkup(rawPath, rawPath)}`;
        });
    };
