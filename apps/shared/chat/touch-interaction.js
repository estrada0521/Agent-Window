    const hoverCapabilityMedia = window.matchMedia("(hover: hover) and (pointer: fine)");
    const canUseHoverInteractions = () => hoverCapabilityMedia.matches;
    const touchBlurSelector = [
      ".quick-action",
      ".hub-page-menu-btn",
      ".composer-plus-toggle",
      ".target-chip",
      ".copy-btn",
      ".file-card",
      ".attached-files-sheet-close",
      ".send-btn",
      "#scrollToBottomBtn"
    ].join(", ");
    const syncHoverCapabilityClass = () => {
      document.documentElement.classList.toggle("has-hover", canUseHoverInteractions());
    };
    const blurTouchControlAfterTap = (event) => {
      if (canUseHoverInteractions()) return;
      const control = event.target?.closest?.(touchBlurSelector);
      if (!control) return;
      setTimeout(() => {
        if (typeof control.blur === "function") control.blur();
        const active = document.activeElement;
        if (active && active.matches?.(touchBlurSelector) && typeof active.blur === "function") {
          active.blur();
        }
      }, 0);
    };
    syncHoverCapabilityClass();
    if (hoverCapabilityMedia.addEventListener) {
      hoverCapabilityMedia.addEventListener("change", syncHoverCapabilityClass);
    } else if (hoverCapabilityMedia.addListener) {
      hoverCapabilityMedia.addListener(syncHoverCapabilityClass);
    }
    document.addEventListener("click", blurTouchControlAfterTap, true);
