    const LIST_FLIP_MS = 220;
    const LIST_FLIP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

    function captureListRowRects(root, selector, keyFn) {
      if (!root) return null;
      const rects = new Map();
      root.querySelectorAll(selector).forEach((el) => {
        const key = keyFn(el);
        if (key) rects.set(key, el.getBoundingClientRect());
      });
      return rects;
    }

    function flipListRows(root, selector, keyFn, firstRects) {
      if (!root || !firstRects || !firstRects.size) return;
      if (typeof Element === "undefined" || typeof Element.prototype.animate !== "function") return;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      root.querySelectorAll(selector).forEach((el) => {
        const key = keyFn(el);
        const first = firstRects.get(key);
        if (!first) return;
        const last = el.getBoundingClientRect();
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        if (!dx && !dy) return;
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
          { duration: LIST_FLIP_MS, easing: LIST_FLIP_EASING },
        );
      });
    }
