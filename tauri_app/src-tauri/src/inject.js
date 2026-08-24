(function() {
  const cssText = `
    html[data-tauri-app="1"] button,
    html[data-tauri-app="1"] a,
    html[data-tauri-app="1"] input,
    html[data-tauri-app="1"] select,
    html[data-tauri-app="1"] textarea,
    html[data-tauri-app="1"] [role="button"],
    html[data-tauri-app="1"] .desk-sidebar-resizer,
    html[data-tauri-app="1"] .page-header-actions,
    html[data-tauri-app="1"] .page-menu-panel {
      app-region: no-drag;
      -webkit-app-region: no-drag;
    }
  `;

  function isHubDocument(doc) {
    try {
      return !!doc?.getElementById("deskWorkbench");
    } catch (_) {
      return false;
    }
  }

  function ensureTopDragStrip(doc) {
    if (!doc || !doc.documentElement || !doc.body) return;
    if (!isHubDocument(doc)) return;
    doc.documentElement.dataset.tauriRootWindow = "1";
    if (doc.documentElement.dataset.tauriDragListener !== "1") {
      doc.documentElement.dataset.tauriDragListener = "1";
      doc.addEventListener("mousedown", (event) => {
        if (event.button !== 0 || event.clientY > 26) return;
        const target = event.target;
        if (target?.closest?.("button, a, input, select, textarea, [role=button]")) return;
        doc.defaultView?.__TAURI__?.window?.getCurrentWindow?.().startDragging?.().catch(() => {});
      }, true);
    }
    try {
      let strip = doc.getElementById("__ma-top-drag-strip");
      if (!strip) {
        strip = doc.createElement("div");
        strip.id = "__ma-top-drag-strip";
        strip.className = "tauri-top-drag-strip";
        doc.body.appendChild(strip);
      } else if (strip.parentElement !== doc.body) {
        doc.body.appendChild(strip);
      }
    } catch (_) {}
  }

  function applyCssToDocument(doc) {
    if (!doc || !doc.documentElement) return false;
    const isRootWindow = isHubDocument(doc);
    try {
      doc.documentElement.dataset.tauriApp = "1";
      doc.documentElement.dataset.tauriRootWindow = isRootWindow ? "1" : "0";
      doc.defaultView?.sessionStorage?.setItem("agent_window_tauri_app", "1");
      const native = doc.defaultView.__agentWindowNative || (doc.defaultView.__agentWindowNative = {});
      native.isTauriApp = true;
      native.appSettingsLoaded = true;
    } catch (_) {}
    const install = () => {
      try {
        let style = doc.getElementById("__ma-app-native-glass");
        if (!style) {
          style = doc.createElement("style");
          style.id = "__ma-app-native-glass";
          style = doc.head.appendChild(style);
        } else if (style.parentElement === doc.head) {
          doc.head.appendChild(style);
        }
        if (style.textContent !== cssText) style.textContent = cssText;
      } catch (_) {}
      ensureTopDragStrip(doc);
    };
    if (doc.head) install();
    else doc.addEventListener("DOMContentLoaded", install, { once: true });
    return true;
  }

  function applyToIframes(rootDoc = document, depth = 0) {
    if (!rootDoc || depth > 4) return;
    let frames = [];
    try {
      frames = Array.from(rootDoc.querySelectorAll("iframe"));
    } catch (_) {
      return;
    }
    frames.forEach((iframe) => {
      try {
        const childDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!childDoc) return;
        applyCssToDocument(childDoc);
        applyToIframes(childDoc, depth + 1);
      } catch (_) {}
    });
  }

  applyCssToDocument(document);
  applyToIframes(document);
})();
