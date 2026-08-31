    // Off-screen message images stay decoded (and GPU-composited) forever
    // otherwise, since the transcript never unmounts old rows. Pin the
    // currently-rendered box size via width/height before clearing src, so
    // max-width:100%/height:auto (markdown-body.css) keeps the same layout
    // with no image data behind it; restore src once it's back near view.
    const _lazyImageObserver = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const img = entry.target;
            if (entry.isIntersecting) {
              if (img.dataset.lazySrc && !img.getAttribute("src")) {
                img.src = img.dataset.lazySrc;
              }
              continue;
            }
            if (!img.getAttribute("src") || !img.complete || !img.naturalWidth) continue;
            const rect = img.getBoundingClientRect();
            if (rect.width > 0) img.width = Math.round(rect.width);
            if (rect.height > 0) img.height = Math.round(rect.height);
            img.dataset.lazySrc = img.currentSrc || img.getAttribute("src");
            img.removeAttribute("src");
          }
        }, { root: timeline, rootMargin: "1500px 0px 1500px 0px" })
      : null;
    const registerLazyImages = (scope) => {
      if (!_lazyImageObserver || !scope) return;
      const images = scope.tagName === "IMG" ? [scope] : Array.from(scope.querySelectorAll?.(".md-body img") || []);
      for (const img of images) {
        if (img.closest(".md-body")) _lazyImageObserver.observe(img);
      }
    };
    const unregisterLazyImages = (scope) => {
      if (!_lazyImageObserver || !scope) return;
      const images = scope.tagName === "IMG" ? [scope] : Array.from(scope.querySelectorAll?.("img") || []);
      for (const img of images) _lazyImageObserver.unobserve(img);
    };
