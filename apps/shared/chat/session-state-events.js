    const startSessionStateEvents = () => {
      const es = new EventSource(withChatBase("/session-state-events"));
      es.addEventListener("state", (event) => {
        const payload = JSON.parse(event.data || "{}");
        let projections = normalizeSessionStateProjections(payload?.projections);
        if (projections.includes("messages")) {
          void refresh();
          projections = projections.filter((projection) => projection !== "messages");
        }
        if (projections.length) void refreshSessionState(projections);
      });
      es.onopen = () => {
        setStatus("");
      };
      es.onerror = () => {
        setStatus("session events disconnected", true);
      };
    };
    startSessionStateEvents();
    void refreshSessionState();
