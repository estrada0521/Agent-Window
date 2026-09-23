    const startWorkspaceSyncEvents = () => {
      if (workspaceSyncEventSource) return;
      const es = new EventSource(withChatBase("/workspace-sync-events"));
      es.addEventListener("sync", (event) => {
        handleWorkspaceSyncUpdate(JSON.parse(event.data || "{}"));
      });
      es.onerror = () => {
        if (typeof setStatus === "function") setStatus("workspace events disconnected", true);
      };
      workspaceSyncEventSource = es;
    };
    startWorkspaceSyncEvents();
