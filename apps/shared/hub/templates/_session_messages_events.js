    const startHubSessionMessagesEvents = (refreshSessions) => {
      if (typeof EventSource !== "function") return;
      const events = new EventSource("/session-messages-events");
      events.addEventListener("messages", () => {
        void refreshSessions();
      });
    };
