    let chatEventsOpened = false;
    const chatEvents = new EventSource(withChatBase("/events"));
    chatEvents.addEventListener("messages", () => { void refresh(); });
    chatEvents.addEventListener("state", () => { void refreshSessionState(); });
    chatEvents.addEventListener("files", handleWorkspaceFilesChanged);
    chatEvents.addEventListener("git", handleWorkspaceGitChanged);
    chatEvents.addEventListener("failure", (event) => { setStatus(JSON.parse(event.data), true); });
    chatEvents.onopen = () => {
      setStatus("");
      if (!chatEventsOpened) {
        chatEventsOpened = true;
        return;
      }
      void refresh();
      void refreshSessionState();
      handleWorkspaceFilesChanged();
      handleWorkspaceGitChanged();
    };
    chatEvents.onerror = () => {
      setStatus("Disconnected", true);
    };
