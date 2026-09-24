    const HUD_VISIBLE_MS = 2500;
    const createHud = (hud) => {
      let timer = 0;
      let transient = "";
      const residents = new Map();
      let shownText = "";
      let state = "hidden";
      const transitionMs = parseFloat(getComputedStyle(hud).transitionDuration) * 1000;
      const currentText = () => transient || [...residents.values()].at(-1) || "";
      const setText = (text) => {
        shownText = text;
        const span = document.createElement("span");
        span.className = "hud-text";
        span.textContent = text;
        hud.replaceChildren(span);
      };
      const morph = (text) => {
        const from = hud.getBoundingClientRect().width;
        hud.style.width = "";
        setText(text);
        const to = hud.getBoundingClientRect().width;
        hud.style.width = `${from}px`;
        void hud.offsetWidth;
        hud.style.width = `${to}px`;
      };
      const toggle = (visible) => {
        state = visible ? "showing" : "hiding";
        hud.classList.toggle("is-visible", visible);
        window.setTimeout(settle, transitionMs);
      };
      const render = () => {
        if (state === "showing" || state === "hiding") return;
        const target = currentText();
        if (state === "hidden") {
          if (!target) return;
          setText(target);
          toggle(true);
          return;
        }
        if (!target) {
          toggle(false);
          return;
        }
        if (target !== shownText) morph(target);
      };
      const settle = () => {
        if (state === "showing") {
          state = "visible";
          if (currentText() !== shownText) {
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
      const setResidentStatus = (key, text) => {
        residents.delete(key);
        if (text) residents.set(key, text);
        render();
      };
      return { setStatus, setResidentStatus };
    };
