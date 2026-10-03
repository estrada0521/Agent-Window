    const HUD_VISIBLE_MS = 2500;
    const createHud = (hud, onVisibilityChange = () => {}) => {
      let timer = 0;
      let transient = "";
      let overlay = null;
      let background = null;
      let covered = false;
      const residents = new Map();
      let shown = "";
      let state = "hidden";
      let morphTimer = 0;
      const transitionMs = parseFloat(getComputedStyle(hud).transitionDuration) * 1000;
      const currentContent = () => {
        let resident = null;
        for (const entry of residents.values()) {
          if (!resident || entry.priority >= resident.priority) resident = entry;
        }
        return transient || (covered ? "" : overlay || resident?.content || background || "");
      };
      const setContent = (content) => {
        shown = content;
        hud.classList.toggle("has-controls", typeof content !== "string" &&
          (content.matches?.("button, a, input, select, textarea") || !!content.querySelector?.("button, a, input, select, textarea")));
        if (typeof content !== "string") {
          hud.replaceChildren(content);
          return;
        }
        const span = document.createElement("span");
        span.className = "hud-text";
        span.textContent = content;
        hud.replaceChildren(span);
      };
      const morph = (content) => {
        window.clearTimeout(morphTimer);
        const from = hud.getBoundingClientRect().width;
        hud.style.width = "";
        setContent(content);
        const to = hud.getBoundingClientRect().width;
        hud.style.width = `${from}px`;
        void hud.offsetWidth;
        hud.style.width = `${to}px`;
        morphTimer = window.setTimeout(() => { hud.style.width = ""; }, transitionMs);
      };
      const toggle = (visible) => {
        state = visible ? "showing" : "hiding";
        hud.classList.toggle("is-visible", visible);
        onVisibilityChange(visible);
        window.setTimeout(settle, transitionMs);
      };
      const render = () => {
        if (state === "showing" || state === "hiding") return;
        const target = currentContent();
        if (state === "hidden") {
          if (!target) return;
          setContent(target);
          toggle(true);
          return;
        }
        if (!target) {
          toggle(false);
          return;
        }
        if (target !== shown) morph(target);
      };
      const settle = () => {
        if (state === "showing") {
          state = "visible";
          if (currentContent() !== shown) {
            toggle(false);
            return;
          }
        } else {
          state = "hidden";
          hud.style.width = "";
        }
        render();
      };
      const setStatus = (text) => {
        window.clearTimeout(timer);
        transient = text;
        if (text) {
          timer = window.setTimeout(() => {
            transient = "";
            render();
          }, HUD_VISIBLE_MS);
        }
        render();
      };
      const setResidentStatus = (key, text, priority = 0) => {
        residents.delete(key);
        if (text) residents.set(key, { content: text, priority });
        if (overlay && text && priority >= 0) {
          setStatus(text);
          return;
        }
        render();
      };
      const setOverlay = (node) => {
        overlay = node;
        render();
      };
      const setBackgroundStatus = (node) => {
        background = node;
        render();
      };
      const setCovered = (value) => {
        covered = value;
        render();
      };
      return { setStatus, setResidentStatus, setOverlay, setBackgroundStatus, setCovered };
    };
