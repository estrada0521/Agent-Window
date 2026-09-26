    const normalizeEscapedLineBreaks = (text) => {
      const value = String(text ?? "");
      if (!/\\[rn]/.test(value)) return value;
      const matches = value.match(/\\r\\n|\\n|\\r/g) || [];
      if (matches.length < 2 && !/\\n\\n|\\n\s*(?:[-*]|\d+\.|#{1,6}\s)/.test(value)) return value;
      return value.replace(/\\r\\n|\\n|\\r/g, "\n");
    };
    const UNSAFE_URL_ATTR_PATTERN = /^\s*javascript:/i;
    const stripUnsafeMarkup = (root) => {
      root.querySelectorAll("iframe, object, embed, form").forEach((el) => el.remove());
      root.querySelectorAll("*").forEach((el) => {
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
    const markdownEscapeHtml = (value) => String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    const markMarkdownLocalFileCandidates = (root) => {
      if (!root?.querySelectorAll) return;
      root.querySelectorAll("a[href]").forEach((anchor) => {
        if (!anchor || anchor.classList.contains("inline-file-link")) return;
        const href = String(anchor.getAttribute("href") || "").trim();
        if (!pathFromLocalHref(href)) return;
        anchor.classList.add("local-file-candidate");
        anchor.dataset.localFileHref = href;
        anchor.removeAttribute("href");
      });
    };
    const renderMarkdownFallback = (text) => markdownEscapeHtml(String(text ?? "")).replace(/\n/g, "<br>");
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
        const block = codeBlocks.find((b) => b.id === id);
        return block ? block.content : "";
      });

      let html = marked.parse(processedText, { breaks: true, gfm: true });
      if (typeof rewriteMarkdownHtml === "function") {
        html = rewriteMarkdownHtml(html);
      }

      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = html;
      stripUnsafeMarkup(tempDiv);
      applyWrittenOrderedListNumbers(tempDiv, processedText);
      tempDiv.querySelectorAll(".MATH_SAFE_BLOCK").forEach((span) => {
        const block = mathBlocks.find((b) => b.id === span.dataset.id);
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
      const checkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      tempDiv.querySelectorAll("pre").forEach((pre) => {
        const wrap = document.createElement("div");
        wrap.className = "code-block-wrap";
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(pre);
        const escapeAttr = (typeof escapeHtml === "function" ? escapeHtml : markdownEscapeHtml);
        wrap.insertAdjacentHTML("beforeend", `<button class="code-copy-btn" type="button" title="Copy" aria-label="Copy" data-copy-icon="${escapeAttr(copySvg).replaceAll('"', "&quot;")}" data-check-icon="${escapeAttr(checkSvg).replaceAll('"', "&quot;")}">${copySvg}</button>`);
      });

      if (frontmatterHtml) tempDiv.insertAdjacentHTML("afterbegin", frontmatterHtml);
      markMarkdownLocalFileCandidates(tempDiv);

      const out = tempDiv.innerHTML;
      return typeof injectFileCards === "function" ? injectFileCards(out) : out;
    };
