(() => {
  document.addEventListener("contextmenu", (event) => event.preventDefault());
  const root = document.documentElement;
  root.dataset.nativeApp = "1";
  root.dataset.nativeRootWindow = "0";
  if (window.parent === window && ["127.0.0.1", "localhost"].includes(window.location.hostname)) {
    root.style.visibility = "hidden";
    const applyViewport = ({ width, left }) => {
      root.style.width = `${width}px`;
      root.style.left = `${left}px`;
      window.dispatchEvent(new Event("resize"));
    };
    window.webkit.messageHandlers.agentWindow.postMessage({ cmd: "get_window_viewport" }).then((viewport) => {
      if (viewport.rootWindow) {
        root.dataset.nativeRootWindow = "1";
        root.style.position = "absolute";
        root.style.top = "0";
        root.style.height = "100%";
        window.addEventListener("native-window-resize", (event) => applyViewport(event.detail));
        applyViewport(viewport);
      }
      root.style.removeProperty("visibility");
    });
  }
  const installDragStrip = () => {
    const workbench = document.getElementById("deskWorkbench");
    if (!workbench || document.getElementById("nativeTopDragStrip")) return;
    const strip = document.createElement("div");
    strip.id = "nativeTopDragStrip";
    strip.className = "native-top-drag-strip";
    strip.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      window.webkit.messageHandlers.agentWindow.postMessage({ cmd: "start_dragging", args: {} }).catch(() => {});
    });
    workbench.parentElement.appendChild(strip);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installDragStrip, { once: true });
  else installDragStrip();
})();
