    const HUB_INSTANCE = "__HUB_INSTANCE__";
    const startHubSessionMessagesEvents = (refreshSessions) => {
      let opened = false;
      const events = new EventSource("/session-messages-events");
      events.addEventListener("messages", () => {
        void refreshSessions();
      });
      events.onopen = () => {
        if (opened) void refreshSessions();
        opened = true;
      };
    };
