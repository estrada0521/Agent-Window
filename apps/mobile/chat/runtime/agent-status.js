__CHAT_INCLUDE:../../../shared/chat/hub-running-state.js__
    const renderAgentStatus = (statuses) => {
      currentAgentStatuses = { ...statuses };
      syncPaneViewerTabThinkingStatuses();
      renderThinkingIndicator();
      notifyHubRunningState();
    };
__CHAT_INCLUDE:../../../shared/chat/session-state-projections.js__
    const refreshSessionState = async (projections = null) => {
      const requestedProjections = normalizeSessionStateProjections(projections);
      if (sessionStateInFlight) {
        pendingSessionStateRefresh = true;
        pendingSessionStateProjections = mergeSessionStateProjections(pendingSessionStateProjections, requestedProjections);
        return;
      }
      sessionStateInFlight = true;
      try {
        const params = new URLSearchParams();
        params.set("ts", String(Date.now()));
        if (requestedProjections.length) {
          params.set("projections", requestedProjections.join(","));
        }
        const res = await fetchWithTimeout(`/session-state?${params.toString()}`, {}, 4000);
        if (res.ok) applySessionState(await res.json());
      } catch (_) {
      } finally {
        sessionStateInFlight = false;
        if (pendingSessionStateRefresh) {
          const nextProjections = pendingSessionStateProjections;
          pendingSessionStateRefresh = false;
          pendingSessionStateProjections = [];
          queueMicrotask(() => { void refreshSessionState(nextProjections); });
        }
      }
    };
__CHAT_INCLUDE:../../../shared/chat/session-state-events.js__
