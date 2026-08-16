    const rightMenuBtn = document.getElementById("hubPageMenuBtn");
    const rightMenuPanel = document.getElementById("hubPageMenuPanel");
    const nativeHeaderMenuBridge = document.getElementById("hubPageNativeMenuBridge");
    const dedicatedNativeHeaderMenuSelect = document.getElementById("hubPageNativeMenuSelect");
    {
      const bridge = nativeHeaderMenuBridge;
      if (bridge && dedicatedNativeHeaderMenuSelect) {
        bridge.style.left = "-9999px";
        bridge.style.top = "-9999px";
        bridge.style.width = "1px";
        bridge.style.height = "1px";
        bridge.style.opacity = "0";
        bridge.style.pointerEvents = "none";
      } else if (bridge && rightMenuBtn) {
        const syncBridge = () => {
          if (!rightMenuBtn || rightMenuBtn.offsetParent === null) return;
          const rect = rightMenuBtn.getBoundingClientRect();
          const padX = 4;
          const padY = 4;
          let left = Math.max(0, rect.left - padX);
          let top = Math.max(0, rect.top - padY);
          const width = rect.width + (padX * 2);
          const height = rect.height + (padY * 2);
          const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
          if (viewportWidth > 0 && left + width > viewportWidth) {
            left = Math.max(0, viewportWidth - width);
          }
          if (viewportHeight > 0 && top + height > viewportHeight) {
            top = Math.max(0, viewportHeight - height);
          }
          bridge.style.left = `${left}px`;
          bridge.style.top = `${top}px`;
          bridge.style.width = `${width}px`;
          bridge.style.height = `${height}px`;
          bridge.style.opacity = "0";
          bridge.style.pointerEvents = "auto";
          bridge.style.zIndex = "999";
          bridge.style.background = "transparent";
          bridge.style.color = "transparent";
          bridge.style.border = "0";
          bridge.style.outline = "none";
          bridge.style.webkitTapHighlightColor = "transparent";
          Array.from(bridge.options).forEach((opt) => {
            if (opt.dataset.mobileOnly === "1") {
              opt.hidden = false;
              opt.disabled = false;
            }
          });
        };
        syncBridge();
        window.addEventListener("resize", syncBridge, { passive: true });
        window.addEventListener("scroll", syncBridge, { passive: true });
        window.visualViewport && window.visualViewport.addEventListener("resize", syncBridge, { passive: true });
        window.visualViewport && window.visualViewport.addEventListener("scroll", syncBridge, { passive: true });
        rightMenuBtn.addEventListener("pointerdown", syncBridge, { passive: true });
        bridge.addEventListener("pointerdown", () => resetAgentActionNativeMenu({ clearOptions: true }), { passive: true });
        bridge.addEventListener("change", (e) => {
          const action = e.target.value;
          e.target.value = "";
          if (!action) return;
          void runForwardAction(action, { sourceNode: null, keepHeaderOpen: false });
        });
      }
    }
