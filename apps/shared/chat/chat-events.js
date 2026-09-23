    let chatEventsOpened = false;
    const chatEvents = new EventSource(withChatBase("/events"));
    chatEvents.addEventListener("messages", () => { void refresh(); });
    chatEvents.addEventListener("state", () => { void refreshSessionState(); });
    chatEvents.addEventListener("files", handleWorkspaceFilesChanged);
    chatEvents.addEventListener("git", handleWorkspaceGitChanged);
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
      setStatus("chat events disconnected", true);
    };
