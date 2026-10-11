const reportError = (message, error) => {
  console.error(message, error);
  window.parent.postMessage({ type: "file-preview-error", message }, window.location.origin);
};

let pdfjs;
try {
  pdfjs = await import(window.cdnResources.pdf.url);
} catch (error) {
  reportError("Failed to load PDF.js CDN", error);
  throw error;
}
pdfjs.GlobalWorkerOptions.workerSrc = window.cdnResources.pdf_worker.url;

const wrap = document.querySelector(".wrap");
try {
  const pdf = await pdfjs.getDocument({ url: wrap.dataset.pdfUrl }).promise;
  const pages = new Map();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const canvas = entry.target;
      const page = pages.get(canvas);
      const base = page.getViewport({ scale: 1 });
      const width = canvas.clientWidth;
      const ratio = Math.min(window.devicePixelRatio, 2);
      const scale = Math.min(width * ratio / base.width, Math.sqrt(16000000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise
        .then(() => page.cleanup())
        .catch((error) => reportError("Failed to render PDF page", error));
    }
  }, { root: wrap, rootMargin: "100% 0px" });
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page";
    canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    canvas.setAttribute("aria-label", `Page ${number}`);
    wrap.append(canvas);
    pages.set(canvas, page);
    observer.observe(canvas);
  }
} catch (error) {
  reportError("Failed to load PDF", error);
}
