    const startWorkspaceSyncEvents = () => {
      if (typeof EventSource !== "function") return;
      if (workspaceSyncEventSource) return;
      const base = CHAT_BASE_PATH || "";
      const initialUrl = workspaceSyncLastSeq > 0
        ? `${base}/workspace-sync-events?after=${encodeURIComponent(String(workspaceSyncLastSeq))}`
        : `${base}/workspace-sync-events`;
      const es = new EventSource(initialUrl);
      es.addEventListener("sync", (event) => {
        try {
          handleWorkspaceSyncUpdate(JSON.parse(event.data || "{}"));
        } catch (_) {}
      });
      es.onerror = () => {};
      workspaceSyncEventSource = es;
    };
    startWorkspaceSyncEvents();
