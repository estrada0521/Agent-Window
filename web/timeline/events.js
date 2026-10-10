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
        if (revision === gitFollowRevision) setError("Worktrees unavailable", err);
      }
    });
    timelineEvents.addEventListener("git", (event) => {
      if (JSON.parse(event.data) === gitTree()) handleWorkspaceGitChanged();
    });
    timelineEvents.addEventListener("hud-error", (event) => { setError(JSON.parse(event.data)); });
    timelineEvents.addEventListener("failure", (event) => { setError("Update failed", JSON.parse(event.data)); });
    timelineEvents.onopen = () => {
      setResidentError("disconnected", "");
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
      setResidentError("disconnected", "Disconnected");
    };
