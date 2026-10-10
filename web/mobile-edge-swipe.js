    document.addEventListener("touchstart", (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      const width = window.innerWidth || 0;
      if (touch.clientX < 24 || touch.clientX > width - 24) event.preventDefault();
    }, { capture: true, passive: false });
