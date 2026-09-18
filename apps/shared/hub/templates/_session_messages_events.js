    const startHubSessionMessagesEvents = (refreshSessions) => {
      const events = new EventSource("/session-messages-events");
      events.addEventListener("messages", () => {
        void refreshSessions();
      });
    };
