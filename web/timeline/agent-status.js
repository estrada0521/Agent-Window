    const _optimisticRunning = new Map();
    let _serverAgentStatuses = {};
    let agentAdded = false;
    let nativeLogWatched = false;
    const addAgentHint = document.createElement("span");
    addAgentHint.className = "add-agent-hint";
    let nativeLogHint = null;
    if (document.documentElement.dataset.mobile === "1") {
      addAgentHint.textContent = "Add Agent from menu (left swipe)";
    } else {
      const menuIcon = document.querySelector("#timelineMenuBtn svg").cloneNode(true);
      const composerIcon = document.querySelector("#composerFabBtn svg").cloneNode(true);
      addAgentHint.append("Add Agent from menu (", menuIcon.cloneNode(true), ")");
      const hintRow = (...parts) => {
        const row = document.createElement("span");
        row.append(...parts);
        return row;
      };
      nativeLogHint = document.createElement("span");
      nativeLogHint.className = "native-log-hint";
      nativeLogHint.append(
        hintRow("Open CLI: menu (", menuIcon, ") → tmux pane"),
        hintRow("Open Composer: bottom ", composerIcon, ", Enter, or press the mouse wheel"),
        hintRow("First send starts native log monitoring"),
      );
    }
    const syncAddAgentHint = () => {
      const noAgent = sessionActive && !agentAdded && !availableTargets.length;
      const awaitingLog = document.documentElement.dataset.mobile !== "1" && sessionActive && agentAdded && availableTargets.length > 0 && !nativeLogWatched;
      setResidentStatus("add-agent-hint", noAgent ? addAgentHint : awaitingLog ? nativeLogHint : "", -1);
    };
    const markAgentOptimisticallyRunning = (agent) => {
      const now = Date.now();
      _optimisticRunning.set(agent, { started: now, until: now + 4000, confirmed: false });
      renderAgentStatus(_serverAgentStatuses);
      const settle = () => {
        if (!_optimisticRunning.has(agent)) return;
        void refreshTimelineState();
      };
      setTimeout(settle, 600);
      setTimeout(settle, 4000);
    };
    const renderAgentStatus = (statuses) => {
      _serverAgentStatuses = { ...(statuses || {}) };
      let merged = _serverAgentStatuses;
      if (_optimisticRunning.size) {
        const now = Date.now();
        for (const [agent, o] of _optimisticRunning) {
          if (_serverAgentStatuses[agent] === "running") {
            o.confirmed = true;
            continue;
          }
          if (o.confirmed || now >= o.until || now >= o.started + 600) {
            _optimisticRunning.delete(agent);
            continue;
          }
          if (merged === _serverAgentStatuses) merged = { ..._serverAgentStatuses };
          merged[agent] = "running";
        }
      }
      currentAgentStatuses = { ...merged };
      renderThinkingIndicator();
    };
    const applyTimelineState = (data) => {
      if (!data || typeof data !== "object") return;
      if (typeof data.timeline === "string" && data.timeline) {
        currentTimelineName = data.timeline;
        if (document.documentElement.dataset.mobile === "1") {
          const timelineChanged = repoTimeline !== currentTimelineName;
          repoTimeline = currentTimelineName;
          if (latestPayloadData) updateRepoPanel(displayEntriesForData(latestPayloadData));
          if (timelineChanged) void refreshGitSummaryHud();
        }
      }
      if (typeof data.active === "boolean") {
        sessionActive = data.active;
      }
      document.getElementById("message").disabled = !sessionActive;
      const _attachBtn = document.getElementById("attachBtn");
      if (_attachBtn) _attachBtn.disabled = !sessionActive;
      if (typeof data.timeline === "string" && data.timeline) {
        restoreComposerDraft();
      }
      updateSendBtnVisibility();
      const resolvedTargets = normalizedTimelineTargets(data.targets);
      if (resolvedTargets.length) agentAdded = true;
      if (data.native_log_watching === true) nativeLogWatched = true;
      const picker = document.getElementById("targetPicker");
      if (!picker.dataset.loaded) {
        selectedTargets = loadTargetSelection(currentTimelineName, resolvedTargets);
        saveTargetSelection(currentTimelineName, selectedTargets);
        picker.dataset.loaded = "1";
      }
      const nextTargetsSig = JSON.stringify(resolvedTargets);
      if (nextTargetsSig !== JSON.stringify(availableTargets)) {
        availableTargets = resolvedTargets;
        selectedTargets = selectedTargets.filter((target) => availableTargets.includes(target));
        saveTargetSelection(currentTimelineName, selectedTargets);
        renderTargetPicker(availableTargets);
      }
      currentRunningDisplay = { ...data.running_display };
      Object.keys(currentRunningDisplay).forEach((agent) => {
        if (data.statuses[agent] !== "running") {
          delete currentRunningDisplay[agent];
        }
      });
      syncThinkingRunningItems(data.statuses, { suppressRender: true });
      renderAgentStatus(data.statuses);
      syncSessionMenuOptions();
      syncAddAgentHint();
      setResidentStatus("thread-stopped", data.stopped_threads.join(" · "));
      if (document.documentElement.dataset.mobile !== "1" && typeof data.timeline === "string" && data.timeline) {
        onTimelineSummaryPinReload();
      }
    };
    const refreshTimelineState = async () => {
      if (refreshTimelineState.inFlight) {
        refreshTimelineState.pending = true;
        return;
      }
      refreshTimelineState.inFlight = true;
      try {
        const res = await fetchWithTimeout(`/timeline-state?ts=${Date.now()}`, {}, 4000);
        if (!res.ok) throw new Error("timeline state unavailable");
        applyTimelineState(await res.json());
        setResidentStatus("state-failed", "");
      } catch (err) {
        setResidentStatus("state-failed", err?.message || String(err));
      } finally {
        refreshTimelineState.inFlight = false;
        if (refreshTimelineState.pending) {
          refreshTimelineState.pending = false;
          queueMicrotask(() => { void refreshTimelineState(); });
        }
      }
    };
    refreshTimelineState.inFlight = false;
    refreshTimelineState.pending = false;
    void refreshTimelineState();
