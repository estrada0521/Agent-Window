    const _optimisticRunning = new Map();
    const markAgentOptimisticallyRunning = (agent) => {
      const now = Date.now();
      _optimisticRunning.set(agent, { started: now, until: now + 4000, confirmed: false });
      currentAgentStatuses[agent] = "running";
      const settle = () => {
        if (!_optimisticRunning.has(agent)) return;
        renderAgentStatus(currentAgentStatuses);
      };
      setTimeout(settle, 600);
      setTimeout(settle, 4000);
    };
    const renderAgentStatus = (statuses) => {
      let merged = statuses;
      if (_optimisticRunning.size) {
        const now = Date.now();
        for (const [agent, o] of _optimisticRunning) {
          if (statuses[agent] === "running") { o.confirmed = true; continue; }
          if (o.confirmed || now >= o.until || now >= o.started + 600) {
            _optimisticRunning.delete(agent);
            continue;
          }
          if (merged === statuses) merged = { ...statuses };
          merged[agent] = "running";
        }
      }
      currentAgentStatuses = { ...merged };
      renderThinkingIndicator();
    };
    const applySessionState = (data) => {
      if (!data || typeof data !== "object") return;
      if (typeof data.session === "string" && data.session) {
        currentSessionName = data.session;
        if (document.documentElement.dataset.mobile === "1") {
          repoSession = currentSessionName;
          if (latestPayloadData) updateRepoPanel(displayEntriesForData(latestPayloadData));
        }
      }
      if (typeof data.active === "boolean") {
        sessionActive = data.active;
      }
      document.getElementById("message").disabled = !sessionActive;
      const _attachBtn = document.getElementById("attachBtn");
      if (_attachBtn) _attachBtn.disabled = !sessionActive;
      renderStatus();
      if (typeof data.session === "string" && data.session) {
        restoreComposerDraft();
      }
      const resolvedTargets = normalizedSessionTargets(data.targets);
      const picker = document.getElementById("targetPicker");
      if (!picker.dataset.loaded) {
        selectedTargets = loadTargetSelection(currentSessionName, resolvedTargets);
        saveTargetSelection(currentSessionName, selectedTargets);
        picker.dataset.loaded = "1";
      }
      const nextTargetsSig = JSON.stringify(resolvedTargets);
      if (nextTargetsSig !== JSON.stringify(availableTargets)) {
        availableTargets = resolvedTargets;
        selectedTargets = selectedTargets.filter((target) => availableTargets.includes(target));
        saveTargetSelection(currentSessionName, selectedTargets);
        renderTargetPicker(availableTargets);
      }
      currentAgentRuntime = { ...data.agent_runtime };
      Object.keys(currentAgentRuntime).forEach((agent) => {
        if (data.statuses[agent] !== "running") {
          delete currentAgentRuntime[agent];
        }
      });
      syncThinkingRuntimeItems(data.statuses, { suppressRender: true });
      renderAgentStatus(data.statuses);
      if (document.documentElement.dataset.mobile !== "1" && typeof data.session === "string" && data.session) {
        dpOnSessionSummaryPinReload();
      }
    };
    const refreshSessionState = async () => {
      if (refreshSessionState.inFlight) {
        refreshSessionState.pending = true;
        return;
      }
      refreshSessionState.inFlight = true;
      try {
        const res = await fetchWithTimeout(`/session-state?ts=${Date.now()}`, {}, 4000);
        if (!res.ok) throw new Error("session state unavailable");
        applySessionState(await res.json());
      } catch (err) {
        setStatus(err?.message || String(err), true);
      } finally {
        refreshSessionState.inFlight = false;
        if (refreshSessionState.pending) {
          refreshSessionState.pending = false;
          queueMicrotask(() => { void refreshSessionState(); });
        }
      }
    };
    refreshSessionState.inFlight = false;
    refreshSessionState.pending = false;
__CHAT_INCLUDE:../session-state-events.js__
