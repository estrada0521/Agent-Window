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
      const errorContent = (message) => {
        const content = document.createElement("span");
        content.className = "hud-text hud-error";
        content.innerHTML = '<svg class="hud-error-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#ff3b30"/><path d="M10 5v6" stroke="white" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="14.5" r="1" fill="white"/></svg>';
        content.append(document.createTextNode(message));
        return content;
      };
      const setError = (message, error) => {
        if (error !== undefined) console.error(message, error);
        setStatus(errorContent(message));
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
      const setResidentError = (key, message) => {
        const previous = residents.get(key)?.content;
        const content = message
          ? previous?.classList?.contains("hud-error") && previous.textContent === message
            ? previous : errorContent(message)
          : "";
        setResidentStatus(key, content);
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
      return { setStatus, setError, setResidentStatus, setResidentError, setOverlay, setBackgroundStatus, setCovered };
    };
