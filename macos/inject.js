(() => {
  const root = document.documentElement;
  root.dataset.nativeApp = "1";
  const installDragStrip = () => {
    const workbench = document.getElementById("deskWorkbench");
    root.dataset.nativeRootWindow = workbench ? "1" : "0";
    if (!workbench || document.getElementById("nativeTopDragStrip")) return;
    const strip = document.createElement("div");
    strip.id = "nativeTopDragStrip";
    strip.className = "native-top-drag-strip";
    strip.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      window.webkit.messageHandlers.agentWindow.postMessage({ cmd: "start_dragging", args: {} }).catch(() => {});
    });
    workbench.appendChild(strip);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installDragStrip, { once: true });
  else installDragStrip();
})();
