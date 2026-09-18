    const startSessionStateEvents = () => {
      const es = new EventSource(withChatBase("/session-state-events"));
      es.addEventListener("state", () => {
        void refresh();
        void refreshSessionState();
      });
      es.onopen = () => {
        setStatus("");
        void refresh();
        void refreshSessionState();
      };
      es.onerror = () => {
        setStatus("session events disconnected", true);
      };
    };
    startSessionStateEvents();
    void refreshSessionState();
