(() => {
  const root = document.documentElement;
  root.dataset.nativeApp = "1";
  const installDragStrip = () => {
    const workbench = document.getElementById("deskWorkbench");
    root.dataset.nativeRootWindow = workbench ? "1" : "0";
    if (!workbench || document.getElementById("nativeTopDragStrip")) return;
    const applyViewport = ({ width, left }) => {
      root.style.width = `${width}px`;
      root.style.left = `${left}px`;
      window.dispatchEvent(new Event("resize"));
    };
    window.addEventListener("native-window-resize", (event) => applyViewport(event.detail));
    window.webkit.messageHandlers.agentWindow.postMessage({ cmd: "get_window_viewport" }).then(applyViewport);
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
