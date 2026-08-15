__CHAT_INCLUDE:../../../shared/chat/hub-session-events.js__
    const renderAgentStatus = (statuses) => {
      currentAgentStatuses = { ...statuses };
      syncPaneViewerTabThinkingStatuses();
      renderThinkingIndicator();
      notifyHubRunningState();
    };
__CHAT_INCLUDE:../../../shared/chat/session-state-projections.js__
    const applySessionState = (data) => {
      if (!data || typeof data !== "object") return;
      const hasOwn = (key) => Object.prototype.hasOwnProperty.call(data, key);
      if (typeof data.session === "string" && data.session) {
        currentSessionName = data.session;
      }
      if (typeof data.active === "boolean") {
        sessionActive = data.active;
      }
      if (hasOwn("targets")) {
        const resolvedTargets = normalizedSessionTargets(data.targets);
        const nextTargetsSig = JSON.stringify(resolvedTargets);
        if (nextTargetsSig !== JSON.stringify(availableTargets)) {
          availableTargets = resolvedTargets;
          selectedTargets = selectedTargets.filter((target) => availableTargets.includes(target));
          saveTargetSelection(currentSessionName, selectedTargets);
          renderTargetPicker(availableTargets);

        }
      }
      document.getElementById("message").disabled = !sessionActive;
      setQuickActionsDisabled(!sessionActive);
      if (!sessionActive) {
        setStatus("archived session is read-only");
      }
      maybeAutoOpenComposer();
      if (hasOwn("agent_runtime") && data.agent_runtime && typeof data.agent_runtime === "object") {
        currentAgentRuntime = { ...data.agent_runtime };
      } else if (hasOwn("agent_runtime")) {
        currentAgentRuntime = {};
      }
      if (data.statuses && typeof data.statuses === "object") {
        Object.keys(currentAgentRuntime).forEach((agent) => {
          if (data.statuses[agent] !== "running") {
            delete currentAgentRuntime[agent];
          }
        });
        syncThinkingRuntimeItems(data.statuses, { suppressRender: true });
        renderAgentStatus(data.statuses);
      } else {
        if (hasOwn("agent_runtime")) {
          syncThinkingRuntimeItems(currentAgentStatuses, { suppressRender: true });
        }
        renderThinkingIndicator();
      }
    };
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
