    const startWorkspaceSyncEvents = () => {
      if (typeof EventSource !== "function") return;
      if (workspaceSyncEventSource) return;
      const path = workspaceSyncLastSeq > 0
        ? `/workspace-sync-events?after=${encodeURIComponent(String(workspaceSyncLastSeq))}`
        : "/workspace-sync-events";
      const es = new EventSource(withChatBase(path));
      es.addEventListener("sync", (event) => {
        handleWorkspaceSyncUpdate(JSON.parse(event.data || "{}"));
      });
      es.onerror = () => {
        if (typeof setStatus === "function") setStatus("workspace events disconnected", true);
      };
      workspaceSyncEventSource = es;
    };
    startWorkspaceSyncEvents();
