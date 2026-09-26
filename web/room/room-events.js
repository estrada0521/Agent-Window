    let roomEventsOpened = false;
    const roomEvents = new EventSource(withRoomBase("/events"));
    roomEvents.addEventListener("messages", () => { void refresh(); });
    roomEvents.addEventListener("state", () => { void refreshSessionState(); });
    roomEvents.addEventListener("files", handleWorkspaceFilesChanged);
    roomEvents.addEventListener("git", handleWorkspaceGitChanged);
    roomEvents.addEventListener("failure", (event) => { setStatus(JSON.parse(event.data)); });
    roomEvents.onopen = () => {
      setResidentStatus("disconnected", "");
      if (!roomEventsOpened) {
        roomEventsOpened = true;
        return;
      }
      void refresh();
      void refreshSessionState();
      handleWorkspaceFilesChanged();
      handleWorkspaceGitChanged();
    };
    roomEvents.onerror = () => {
      if (reloadInFlight) return;
      setResidentStatus("disconnected", "Disconnected");
    };
