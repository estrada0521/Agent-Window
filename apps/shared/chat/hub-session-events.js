    const HUB_MESSAGES_CHANGED_MIN_MS = 3000;
    let hubMessagesChangedAt = 0;
    let hubMessagesChangedTimer = 0;
    const notifyHubMessagesChanged = () => {
      if (window.parent === window) return;
      const sessionName = String(currentSessionName || "").trim();
      if (!sessionName) return;
      const post = () => {
        hubMessagesChangedAt = Date.now();
        try {
          window.parent.postMessage({ type: "session-messages-changed", sessionName }, "*");
        } catch (_) {}
      };
      const elapsed = Date.now() - hubMessagesChangedAt;
      if (elapsed >= HUB_MESSAGES_CHANGED_MIN_MS) {
        post();
        return;
      }
      if (hubMessagesChangedTimer) return;
      hubMessagesChangedTimer = window.setTimeout(() => {
        hubMessagesChangedTimer = 0;
        post();
      }, HUB_MESSAGES_CHANGED_MIN_MS - elapsed);
    };
