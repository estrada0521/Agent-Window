    const paneTraceHtml = (raw) => escapeHtml(String(raw ?? "No output"))
      .replace(/\n/g, "<br>")
      .replace(/[●⏺]/g, '<span class="trace-dot">●</span>');
