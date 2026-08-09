    const startSessionStateEvents = () => {
      if (typeof EventSource !== "function") return;
      const es = new EventSource(withChatBase("/session-state-events"));
      es.addEventListener("state", (event) => {
        let projections = [];
        try {
          const payload = JSON.parse(event.data || "{}");
          projections = normalizeSessionStateProjections(payload?.projections);
        } catch (_) {}
        if (projections.includes("messages")) {
          void refresh();
          projections = projections.filter((projection) => projection !== "messages");
        }
        if (projections.length) void refreshSessionState(projections);
      });
      es.onerror = () => {};
    };
    startSessionStateEvents();
    void refreshSessionState();
