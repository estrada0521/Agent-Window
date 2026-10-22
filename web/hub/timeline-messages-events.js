    const SERVER_INSTANCE_SEED = "__SERVER_INSTANCE__";
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
      return () => events.close();
    };
