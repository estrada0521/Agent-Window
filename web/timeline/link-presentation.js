    const wireLinkPresentation = (() => {
      const wired = new WeakSet();
      const fileSelector = "a.inline-file-link, a.local-file-link, summary";
      const externalLink = (anchor) => {
        if (!anchor || anchor.matches(".inline-file-link, .local-file-link, .local-file-candidate")) return false;
        return anchor.protocol === "http:" || anchor.protocol === "https:" || anchor.protocol === "mailto:";
      };
      return (root, { press = false } = {}) => {
        if (!root || wired.has(root)) return;
        wired.add(root);
        root.addEventListener("mouseover", (event) => {
          const anchor = event.target.closest?.("a[href]");
          if (externalLink(anchor)) anchor.title = anchor.href;
        });
        if (!press) return;
        const doc = root.ownerDocument || root;
        const scope = root.nodeType === 9 ? root.documentElement : root;
        scope.classList.add("agent-link-presentation-root");
        if (!doc.getElementById("agent-link-press-style")) {
          const style = doc.createElement("style");
          style.id = "agent-link-press-style";
          style.textContent = `.agent-link-presentation-root a[href]{-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
            a.agent-external-link-press{display:inline-block;transition:transform var(--liquid-glass-press-out,600ms cubic-bezier(0.16,1,0.3,1))}
            a.agent-external-link-press.is-pressed{transform:scale(var(--liquid-glass-press-scale,1.06));transition:transform var(--liquid-glass-press-in,120ms ease-out)}`;
          doc.head.appendChild(style);
        }
        let touch = null;
        const clear = () => {
          touch?.node?.classList.remove("is-pressed");
          touch = null;
        };
        const pressable = (target) => {
          const node = target.closest?.("a[href], summary");
          return node?.matches(fileSelector) || externalLink(node) ? node : null;
        };
        root.addEventListener("touchstart", (event) => {
          clear();
          const node = pressable(event.target);
          const point = event.touches?.[0];
          if (!node || !point) return;
          if (externalLink(node)) node.classList.add("agent-external-link-press");
          node.classList.add("is-pressed");
          touch = { node, x: point.clientX, y: point.clientY };
        }, { passive: true });
        root.addEventListener("touchmove", (event) => {
          if (!touch) return;
          const point = event.touches?.[0];
          if (point && (point.clientX - touch.x) ** 2 + (point.clientY - touch.y) ** 2 > 100) clear();
        }, { passive: true });
        root.addEventListener("touchend", clear, { passive: true });
        root.addEventListener("touchcancel", clear, { passive: true });
        root.addEventListener("contextmenu", (event) => {
          if (pressable(event.target)) event.preventDefault();
        });
      };
    })();
