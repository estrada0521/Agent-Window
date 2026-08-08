    let paneTraceAnsiUp = null;
    let paneTraceAnsiLoadPromise = null;
    const ensurePaneTraceAnsiUp = async () => {
      if (paneTraceAnsiUp) return true;
      try {
        if (typeof AnsiUp === "function") {
          paneTraceAnsiUp = new AnsiUp();
          return true;
        }
      } catch (_) {
        paneTraceAnsiUp = null;
      }
      if (paneTraceAnsiLoadPromise) return paneTraceAnsiLoadPromise;
      paneTraceAnsiLoadPromise = loadExternalScriptOnce(ANSI_UP_SRC).then((ready) => {
        if (!ready) return false;
        try {
          if (typeof AnsiUp === "function") paneTraceAnsiUp = new AnsiUp();
        } catch (_) {
          paneTraceAnsiUp = null;
        }
        return !!paneTraceAnsiUp;
      }).finally(() => {
        if (!paneTraceAnsiUp) paneTraceAnsiLoadPromise = null;
      });
      return paneTraceAnsiLoadPromise;
    };
    const paneTraceHtml = (raw) => {
      const text = String(raw ?? "No output");
      if (!paneTraceAnsiUp) {
        try {
          if (typeof AnsiUp === "function") paneTraceAnsiUp = new AnsiUp();
        } catch (_) {
          paneTraceAnsiUp = null;
        }
      }
      let html;
      if (paneTraceAnsiUp) {
        try {
          html = paneTraceAnsiUp.ansi_to_html(text);
        } catch (_) {
          html = null;
        }
      }
      if (!html) {
        const plain = stripAnsiForTrace(text);
        html = escapeHtml(plain).replace(/\n/g, "<br>");
      }
      return html.replace(/[●⏺]/g, '<span class="trace-dot">●</span>');
    };
