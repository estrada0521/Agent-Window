(function() {
  const cssText = `
    html[data-tauri-app="1"] button,
    html[data-tauri-app="1"] a,
    html[data-tauri-app="1"] input,
    html[data-tauri-app="1"] select,
    html[data-tauri-app="1"] textarea,
    html[data-tauri-app="1"] [role="button"],
    html[data-tauri-app="1"] .desk-sidebar-resizer,
    html[data-tauri-app="1"] .hub-page-header-actions,
    html[data-tauri-app="1"] .hub-page-menu-panel {
      app-region: no-drag;
      -webkit-app-region: no-drag;
    }
  `;
  const DRAG_REGION_SELECTOR = ".tauri-top-drag-strip, [data-tauri-drag-region], .hub-page-header, .hub-page-header-top";
  const NO_DRAG_SELECTOR = [
    "button",
    "a",
    "input",
    "select",
    "textarea",
    "[role=\"button\"]",
    ".hub-page-header-actions",
    ".hub-page-menu-panel",
    ".hub-page-menu-btn",
    "#hubPageNativeMenuBridge",
    ".desk-sidebar-resizer",
  ].join(", ");

  function ensureTopDragStrip(doc) {
    if (!doc || !doc.documentElement || !doc.body) return;
    if (doc.documentElement.dataset.tauriRootWindow === "0") return;
    let hasHeader = false;
    try {
      hasHeader = !!doc.querySelector(".hub-page-header");
    } catch (_) {}
    if (!hasHeader) return;
    try {
      let strip = doc.getElementById("__ma-top-drag-strip");
      if (!strip) {
        strip = doc.createElement("div");
        strip.id = "__ma-top-drag-strip";
        strip.className = "tauri-top-drag-strip";
        strip.setAttribute("data-tauri-drag-region", "");
        doc.body.appendChild(strip);
      } else if (strip.parentElement !== doc.body) {
        doc.body.appendChild(strip);
      }
    } catch (_) {}
  }

  function markDragRegions(doc) {
    if (!doc || !doc.documentElement) return;
    if (doc.documentElement.dataset.tauriRootWindow === "0") return;
    try {
      doc
        .querySelectorAll(".hub-page-header, .hub-page-header-top")
        .forEach((node) => node.setAttribute("data-tauri-drag-region", ""));
    } catch (_) {}
  }

  function isNoDragTarget(target) {
    return !!(target && typeof target.closest === "function" && target.closest(NO_DRAG_SELECTOR));
  }

  async function startWindowDrag(view) {
    const candidates = [];
    if (view) candidates.push(view);
    try {
      if (view?.parent && view.parent !== view) candidates.push(view.parent);
    } catch (_) {}
    for (const candidate of candidates) {
      const tauri = candidate?.__TAURI__;
      const invoke = tauri?.core?.invoke || tauri?.invoke || candidate?.__TAURI_INTERNALS__?.invoke;
      const label = candidate?.__TAURI_INTERNALS?.metadata?.currentWindow?.label || "main";
      if (typeof invoke === "function") {
        try {
          await invoke("plugin:window|start_dragging", { label });
          return true;
        } catch (_) {}
      }
      if (!tauri) continue;
      try {
        const getCurrentWindow = tauri.window?.getCurrentWindow;
        if (typeof getCurrentWindow === "function") {
          const currentWindow = getCurrentWindow();
          if (currentWindow && typeof currentWindow.startDragging === "function") {
            await currentWindow.startDragging();
            return true;
          }
        }
      } catch (_) {}
      try {
        const appWindow = tauri.window?.appWindow;
        if (appWindow && typeof appWindow.startDragging === "function") {
          await appWindow.startDragging();
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  function installDragHandler(doc) {
    if (!doc || !doc.documentElement || doc.__agentWindowDragHandlerInstalled) return;
    doc.__agentWindowDragHandlerInstalled = true;
    doc.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || event.defaultPrevented) return;
      const target = event.target;
      if (!target || isNoDragTarget(target)) return;
      const inDragRegion = !!(typeof target.closest === "function" && target.closest(DRAG_REGION_SELECTOR));
      if (!inDragRegion) return;
      void startWindowDrag(doc.defaultView);
    }, { capture: true });
  }

  function applyCssToDocument(doc) {
    if (!doc || !doc.documentElement) return false;
    let isRootWindow = true;
    try {
      const view = doc.defaultView;
      isRootWindow = !!(view && view.top === view);
    } catch (_) {
      isRootWindow = true;
    }
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
      markDragRegions(doc);
      installDragHandler(doc);
    };
    if (doc.head) install();
    else doc.addEventListener("DOMContentLoaded", install, { once: true });
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", () => {
        ensureTopDragStrip(doc);
        markDragRegions(doc);
        installDragHandler(doc);
      }, { once: true });
    } else {
      ensureTopDragStrip(doc);
      markDragRegions(doc);
      installDragHandler(doc);
    }
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
