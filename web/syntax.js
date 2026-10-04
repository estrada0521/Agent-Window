(() => {
  const config = JSON.parse(document.getElementById("syntax-config").textContent);
  const root = document.documentElement;
  const MAX_CODE_LENGTH = 512 * 1024;
  const completed = new WeakSet();
  let engine;
  const report = (error) => console.error("Syntax highlighting failed", error);
  const syncTheme = () => {
    root.dataset.syntaxTheme = root.dataset.previewTheme || root.dataset.theme || config.theme;
  };
  const loadEngine = () => engine ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/highlight.min.js";
    script.onload = () => resolve(window.hljs);
    script.onerror = () => reject(new Error("Could not load highlight.js"));
    document.head.append(script);
  });
  const addColors = () => {
    const output = [];
    for (const [mode, css] of Object.entries(config.themes)) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule)) throw new Error("Syntax themes must contain plain CSS style rules");
        const color = rule.style.getPropertyValue("color");
        if (!color) continue;
        const selectors = rule.selectorText.split(",").map((selector) => {
          selector = selector.trim();
          if (!selector.includes(".hljs")) throw new Error("Expected highlight.js theme selectors");
          const hasBase = /\.hljs(?![\w-])/.test(selector);
          selector = selector.replace(/\.hljs(?![\w-])/g, ".aw-syntax");
          return `:root[data-syntax-theme="${mode}"] ${hasBase ? "" : ".aw-syntax "}${selector}`;
        });
        output.push(`${selectors.join(",")} { color: ${color}; }`);
      }
    }
    const style = document.createElement("style");
    style.textContent = output.join("\n");
    document.head.append(style);
  };
  const highlightBlock = async (code) => {
    if (completed.has(code)) return;
    const language = [...code.classList].find((name) => name.startsWith("language-"))?.slice(9);
    if (!language || code.textContent.length > MAX_CODE_LENGTH) return;
    completed.add(code);
    const hljs = await loadEngine();
    if (!code.isConnected || !hljs.getLanguage(language)) return;
    const result = hljs.highlight(code.textContent, { language });
    code.innerHTML = result.value;
    code.classList.add("aw-syntax");
  };
  const languageForFile = (hljs, path) => {
    const name = path.split("/").pop().toLowerCase();
    return hljs.getLanguage(name) ? name : name.split(".").pop();
  };
  const highlightLines = (hljs, text, language) => {
    const parsed = document.createElement("div");
    parsed.innerHTML = hljs.highlight(text, { language }).value;
    const fragments = [document.createDocumentFragment()];
    const walk = (node, classes) => {
      if (node.nodeType === Node.TEXT_NODE) {
        node.textContent.split("\n").forEach((part, index) => {
          if (index) fragments.push(document.createDocumentFragment());
          if (!part) return;
          let content = document.createTextNode(part);
          for (const name of classes.toReversed()) {
            const span = document.createElement("span");
            span.className = name;
            span.append(content);
            content = span;
          }
          fragments.at(-1).append(content);
        });
      } else {
        const next = node.className ? [...classes, node.className] : classes;
        node.childNodes.forEach((child) => walk(child, next));
      }
    };
    parsed.childNodes.forEach((node) => walk(node, []));
    return fragments;
  };
  let fileRevision = 0;
  const highlightFile = async () => {
    const revision = ++fileRevision;
    if (!config.filename) return;
    const table = document.querySelector(".code-table, .preview-text-table");
    if (!table || Number(table.dataset.previewBytes) > MAX_CODE_LENGTH) return;
    const lines = [...table.querySelectorAll("td.lc > pre")];
    const text = lines.map((line) => line.textContent).join("\n");
    if (!lines.length || text.length > MAX_CODE_LENGTH) return;
    const hljs = await loadEngine();
    if (revision !== fileRevision) return;
    const language = languageForFile(hljs, config.filename);
    if (!hljs.getLanguage(language) || !table.isConnected) return;
    const fragments = highlightLines(hljs, text, language);
    if (fragments.length !== lines.length) throw new Error("Highlighted file line count changed");
    lines.forEach((line, index) => {
      line.replaceChildren(fragments[index]);
      if (!line.childNodes.length) line.append(document.createElement("br"));
      line.classList.add("aw-syntax");
    });
  };
  const highlightDiff = async (diff) => {
    if (completed.has(diff) || diff.textContent.length > MAX_CODE_LENGTH) return;
    completed.add(diff);
    const hljs = await loadEngine();
    const language = languageForFile(hljs, diff.closest(".git-file-diff").dataset.path);
    if (!diff.isConnected || !hljs.getLanguage(language)) return;
    let rows = [];
    const applyHunk = () => {
      for (const before of [true, false]) {
        const side = rows.filter((row) => !row.classList.contains(before ? "is-add" : "is-del"));
        if (!side.length) continue;
        const code = side.map((row) => row.querySelector(".git-diff-code"));
        const fragments = highlightLines(hljs, code.map((node) => node.textContent).join("\n"), language);
        if (fragments.length !== side.length) throw new Error("Highlighted diff line count changed");
        code.forEach((node, index) => {
          if (before && !side[index].classList.contains("is-del")) return;
          node.replaceChildren(fragments[index]);
          node.classList.add("aw-syntax");
        });
      }
      rows = [];
    };
    for (const row of diff.querySelectorAll(".git-diff-line")) {
      if (row.classList.contains("is-hunk")) applyHunk();
      else rows.push(row);
    }
    applyHunk();
  };
  const scan = (node) => {
    if (!(node instanceof Element)) return;
    if (node.matches(".git-diff-scroll")) void highlightDiff(node).catch(report);
    node.querySelectorAll(".git-diff-scroll").forEach((diff) => void highlightDiff(diff).catch(report));
    if (node.matches("pre > code")) void highlightBlock(node).catch(report);
    node.querySelectorAll("pre > code").forEach((code) => void highlightBlock(code).catch(report));
  };
  const start = () => {
    try {
      addColors();
      syncTheme();
      new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-preview-theme"] });
      window.addEventListener("message", (event) => {
        if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== "file-preview-theme") return;
        root.dataset.syntaxTheme = event.data.theme === "light" ? "light" : "dark";
      });
      scan(document.body);
      document.addEventListener("file-preview-text-updated", () => void highlightFile().catch(report));
      void highlightFile().catch(report);
      new MutationObserver((records) => {
        for (const record of records) record.addedNodes.forEach(scan);
      }).observe(document.body, { childList: true, subtree: true });
    } catch (error) { report(error); }
  };
  document.addEventListener("DOMContentLoaded", start, { once: true });
})();
