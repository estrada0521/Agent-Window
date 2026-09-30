    let timelineEventsOpened = false;
    const timelineEvents = new EventSource(withTimelineBase("/events"));
    timelineEvents.addEventListener("messages", () => { void refresh(); });
    timelineEvents.addEventListener("state", () => { void refreshTimelineState(); });
    timelineEvents.addEventListener("files", handleWorkspaceFilesChanged);
    const notifyWorktreesChanged = () => document.dispatchEvent(new CustomEvent("git-worktrees-changed"));
    timelineEvents.addEventListener("worktrees", notifyWorktreesChanged);
    timelineEvents.addEventListener("git-follow", async (event) => {
      const revision = ++gitFollowRevision;
      const tree = JSON.parse(event.data);
      if (!gitFollow() || tree === gitTree()) return;
      try {
        const worktrees = await fetchGitWorktrees();
        if (revision === gitFollowRevision && gitFollow() && tree !== gitTree()) applyFollowTree(tree, worktrees);
      } catch (err) {
        if (revision === gitFollowRevision) setStatus(err?.message || "Failed to load worktrees");
      }
    });
    timelineEvents.addEventListener("git", (event) => {
      if (JSON.parse(event.data) === gitTree()) handleWorkspaceGitChanged();
    });
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
      notifyWorktreesChanged();
      handleWorkspaceGitChanged();
    };
    timelineEvents.onerror = () => {
      if (reloadInFlight) return;
      setResidentStatus("disconnected", "Disconnected");
    };
