    const HUB_INSTANCE = "__HUB_INSTANCE__";
    const startHubTimelineMessagesEvents = (refreshTimelines) => {
      let opened = false;
      const events = new EventSource("/timeline-messages-events");
      events.addEventListener("messages", () => {
        void refreshTimelines();
      });
      events.onopen = () => {
        if (opened) void refreshTimelines();
        opened = true;
      };
    };
