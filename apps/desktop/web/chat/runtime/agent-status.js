__CHAT_INCLUDE:../../../../shared/chat/hub-running-state.js__
    const renderAgentStatus = (statuses) => {
      currentAgentStatuses = { ...statuses };
      renderThinkingIndicator();
      notifyHubRunningState();
    };
__CHAT_INCLUDE:../../../../shared/chat/session-state-projections.js__
    const refreshSessionState = async (projections = null) => {
      const requestedProjections = normalizeSessionStateProjections(projections);
      if (refreshSessionState.inFlight) {
        refreshSessionState.pending = mergeSessionStateProjections(refreshSessionState.pending, requestedProjections);
        return false;
      }
      refreshSessionState.inFlight = true;
      try {
        const params = new URLSearchParams();
        params.set("ts", String(Date.now()));
        if (requestedProjections.length) {
          params.set("projections", requestedProjections.join(","));
        }
        const res = await fetch(`/session-state?${params.toString()}`, { cache: "no-store" });
        if (res.ok) {
          applySessionState(await res.json());
          return true;
        }
      } catch (_) {
      } finally {
        refreshSessionState.inFlight = false;
        if (refreshSessionState.pending.length) {
          const nextProjections = [...refreshSessionState.pending];
          refreshSessionState.pending = [];
          queueMicrotask(() => { void refreshSessionState(nextProjections); });
        }
      }
      return false;
    };
    refreshSessionState.inFlight = false;
    refreshSessionState.pending = [];
__CHAT_INCLUDE:../../../../shared/chat/session-state-events.js__
