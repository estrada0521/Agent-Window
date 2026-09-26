    let timelineEventsOpened = false;
    const timelineEvents = new EventSource(withTimelineBase("/events"));
    timelineEvents.addEventListener("messages", () => { void refresh(); });
    timelineEvents.addEventListener("state", () => { void refreshTimelineState(); });
    timelineEvents.addEventListener("files", handleWorkspaceFilesChanged);
    timelineEvents.addEventListener("git", handleWorkspaceGitChanged);
    timelineEvents.addEventListener("failure", (event) => { setStatus(JSON.parse(event.data)); });
    timelineEvents.onopen = () => {
      setResidentStatus("disconnected", "");
      if (!timelineEventsOpened) {
        timelineEventsOpened = true;
        return;
      }
      void refresh();
      void refreshTimelineState();
      handleWorkspaceFilesChanged();
      handleWorkspaceGitChanged();
    };
    timelineEvents.onerror = () => {
      if (reloadInFlight) return;
      setResidentStatus("disconnected", "Disconnected");
    };
