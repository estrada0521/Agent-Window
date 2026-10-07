    const EXPORT_ROW_SELECTOR = "article.message-row, .sysmsg-row";
    let exportRange = null;
    const exportHud = document.createElement("div");
    exportHud.className = "export-hud";
    exportHud.innerHTML = '<button type="button" class="export-hud-cancel" title="Cancel" aria-label="Cancel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button><span class="export-hud-guide">Click messages</span><button type="button" class="export-hud-export"></button>';
    const exportHudExportBtn = exportHud.querySelector(".export-hud-export");
    const exportRows = () => [...messagesEl.querySelectorAll(EXPORT_ROW_SELECTOR)];
    const exportRangeRows = () => {
      if (!exportRange?.start) return [];
      const rows = exportRows();
      const start = rows.indexOf(exportRange.start);
      const end = rows.indexOf(exportRange.end);
      if (start < 0 || end < 0) return [];
      return rows.slice(Math.min(start, end), Math.max(start, end) + 1);
    };
    const syncExportRange = () => {
      messagesEl.querySelectorAll(".export-in-range").forEach((row) => row.classList.remove("export-in-range"));
      if (!exportRange) return;
      const rows = exportRangeRows();
      rows.forEach((row) => row.classList.add("export-in-range"));
      const messages = rows.filter((row) => row.matches("article.message-row")).length;
      exportHud.classList.toggle("is-picked", rows.length > 0);
      exportHudExportBtn.textContent = rows.length ? String(messages) : "";
      exportHudExportBtn.title = rows.length ? `Export ${messages} message${messages === 1 ? "" : "s"}` : "";
    };
    const beginExportRange = (format) => {
      const rows = exportRows();
      if (!rows.length) {
        setError("No messages to export");
        return;
      }
      exportRange = { format, start: null, end: rows[rows.length - 1] };
      document.documentElement.dataset.exportRange = "1";
      exportHud.classList.remove("is-picked");
      syncExportRange();
      setHudOverlay(exportHud);
    };
    const endExportRange = () => {
      exportRange = null;
      delete document.documentElement.dataset.exportRange;
      exportHudExportBtn.classList.remove("is-pressed");
      syncExportRange();
      setHudOverlay(null);
    };
    messagesEl.addEventListener("click", (event) => {
      if (!exportRange) return;
      const row = event.target.closest?.(EXPORT_ROW_SELECTOR);
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      const rows = exportRows();
      if (!exportRange.start || rows.indexOf(row) < rows.indexOf(exportRange.start)) exportRange.start = row;
      else exportRange.end = row;
      syncExportRange();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (!exportRange || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        endExportRange();
        return;
      }
      if (event.key === "Enter" && !event.target.closest?.("textarea, input, [contenteditable]")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void runExport();
      }
    }, true);
    exportHud.querySelector(".export-hud-cancel").addEventListener("click", endExportRange);

    const exportAssetDataUri = async (url, cache) => {
      if (!cache.has(url)) {
        cache.set(url, fetch(url).then(async (res) => {
          if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
          const blob = await res.blob();
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        }));
      }
      return cache.get(url);
    };
    const isSameOriginUrl = (url) => {
      if (/^data:/i.test(url)) return false;
      return new URL(url, location.href).origin === location.origin;
    };
    const splitSelectorList = (text) => {
      const parts = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") depth--;
        else if (text[i] === "," && depth === 0) {
          parts.push(text.slice(start, i).trim());
          start = i + 1;
        }
      }
      parts.push(text.slice(start).trim());
      return parts;
    };
    const exportThemeCss = (rules) => [...rules].map((rule) => {
      if (rule instanceof CSSFontFaceRule) return "";
      if (rule instanceof CSSMediaRule) return `@media ${rule.conditionText}{${exportThemeCss(rule.cssRules)}}`;
      if (!(rule instanceof CSSStyleRule)) return rule.cssText;
      const byTheme = { "": [], light: [], dark: [] };
      for (const selector of splitSelectorList(rule.selectorText)) {
        const theme = selector.match(/\[data-theme="(light|dark)"\]/)?.[1] || "";
        byTheme[theme].push(theme ? selector.replaceAll(`[data-theme="${theme}"]`, ":not([data-theme-none])") : selector);
      }
      const body = `{${rule.style.cssText}}`;
      return [
        byTheme[""].length ? `${byTheme[""].join(",")}${body}` : "",
        ...["light", "dark"].filter((theme) => byTheme[theme].length)
          .map((theme) => `@media (prefers-color-scheme: ${theme}){${byTheme[theme].join(",")}${body}}`),
      ].join("");
    }).join("\n");
    const exportRootAttrs = () => ["desktopTimeline", "mobile", "mobileTimeline"]
      .filter((key) => document.documentElement.dataset[key])
      .map((key) => ` data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${document.documentElement.dataset[key]}"`)
      .join("");
    const buildExportHtml = async (rows) => {
      const host = document.createElement("main");
      host.id = "messages";
      host.append(...rows.map((row) => row.cloneNode(true)));
      const seenSenders = new Set();
      rows.forEach((row, index) => {
        if (!row.matches("article.message-row") || seenSenders.has(row.dataset.sender)) return;
        seenSenders.add(row.dataset.sender);
        if (!row.classList.contains("meta-hidden")) return;
        let leader = row.previousElementSibling;
        while (leader && !(leader.dataset.sender === row.dataset.sender && !leader.classList.contains("meta-hidden"))) leader = leader.previousElementSibling;
        const meta = leader?.querySelector(".message-meta-below");
        if (!meta) return;
        const clone = host.children[index];
        clone.querySelector(".message").prepend(meta.cloneNode(true));
        clone.classList.remove("meta-hidden");
      });
      host.querySelectorAll("button").forEach((node) => node.remove());
      host.querySelectorAll(".export-in-range").forEach((node) => node.classList.remove("export-in-range"));
      host.querySelectorAll(".is-collapsible").forEach((node) => node.classList.remove("is-collapsible"));
      host.querySelectorAll(".is-collapsed").forEach((node) => node.classList.remove("is-collapsed"));
      host.querySelectorAll("a[href]").forEach((anchor) => {
        if (isSameOriginUrl(anchor.getAttribute("href"))) anchor.removeAttribute("href");
      });
      const cache = new Map();
      await Promise.all([...host.querySelectorAll("img[src]")].map(async (img) => {
        const src = img.getAttribute("src");
        if (isSameOriginUrl(src)) img.setAttribute("src", await exportAssetDataUri(src, cache));
      }));
      await Promise.all([...host.querySelectorAll("[style*='url(']")].map(async (node) => {
        let style = node.getAttribute("style");
        for (const [, url] of style.matchAll(/url\((?:&quot;|["'])?(.*?)(?:&quot;|["'])?\)/g)) {
          if (isSameOriginUrl(url)) style = style.replaceAll(url, await exportAssetDataUri(url, cache));
        }
        node.setAttribute("style", style);
      }));
      const css = [...document.querySelectorAll("style")].map((node) => exportThemeCss(node.sheet.cssRules)).join("\n");
      const katex = host.querySelector(".katex") ? `<link rel="stylesheet" href="${KATEX_CSS.url}" integrity="${KATEX_CSS.integrity}" crossorigin="anonymous">` : "";
      const title = escapeHtml(document.title);
      return `<!DOCTYPE html>
<html lang="en"${exportRootAttrs()}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${katex}<style>${css}</style>
<style>.shell{height:auto;overflow:visible}main#messages{position:static;overflow:visible;padding-block:3em}main#messages::before,main#messages::after{display:none}</style>
</head>
<body>
<section class="shell">${host.outerHTML}</section>
</body>
</html>
`;
    };
    const exportFileStem = (rows) => {
      const entries = displayEntriesForData(latestPayloadData);
      const [start, end] = [rows[0], rows[rows.length - 1]].map((row) => {
        const timestamp = entries.find((entry) => entry.context_hash === row.dataset.contextHash)?.timestamp;
        if (!timestamp) throw new Error("No timestamp for the range");
        return { day: timestamp.slice(0, 10), time: timestamp.slice(11, 16).replace(":", "") };
      });
      const name = document.title.split(" · ")[0] || "timeline";
      return start.day === end.day
        ? `${name} ${start.day} ${start.time}-${end.time}`
        : `${name} ${start.day} ${start.time} - ${end.day} ${end.time}`;
    };
    const runExport = async () => {
      const rows = exportRangeRows();
      if (!rows.length) return;
      try {
        const name = exportFileStem(rows);
        let file;
        if (exportRange.format === "jsonl") {
          const params = new URLSearchParams({ from: rows[0].dataset.contextHash || "", to: rows[rows.length - 1].dataset.contextHash || "" });
          const res = await fetch(`/log-slice?${params.toString()}`);
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
          file = new File([await res.blob()], `${name}.jsonl`, { type: "application/x-ndjson" });
        } else {
          file = new File([await buildExportHtml(rows)], `${name}.html`, { type: "text/html" });
        }
        if (document.documentElement.dataset.mobile === "1") {
          await navigator.share({ files: [file] });
          endExportRange();
          return;
        }
        const link = document.createElement("a");
        link.href = URL.createObjectURL(file);
        link.download = file.name;
        link.click();
        endExportRange();
        setStatus(document.documentElement.dataset.nativeApp === "1" ? "Exported to ~/Downloads" : "Exported");
      } catch (err) {
        if (err?.name !== "AbortError") setError("Export failed", err);
      }
    };
    exportHudExportBtn.addEventListener("click", () => void runExport());
    if (document.documentElement.dataset.mobile === "1") {
      const clearExportPressed = () => exportHudExportBtn.classList.remove("is-pressed");
      exportHudExportBtn.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || exportHudExportBtn.disabled) return;
        exportHudExportBtn.classList.add("is-pressed");
      });
      exportHudExportBtn.addEventListener("pointerleave", clearExportPressed);
      document.addEventListener("pointerup", clearExportPressed, true);
      document.addEventListener("pointercancel", clearExportPressed, true);
    }
