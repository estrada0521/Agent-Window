    let refreshEpoch = 0;
    const applyLocalEntry = (entry) => {
      refreshEpoch += 1;
      const current = latestPayloadData || {};
      render({ ...current, entries: [...(current.entries || []), entry].slice(-MESSAGE_BATCH) });
      void refresh();
    };
    const refresh = async (options = {}) => {
      const refreshOptions = !hasInitialRefreshHydrated
        ? mergeRefreshOptions(options, { forceScroll: true })
        : options;
      if (refreshInFlight) {
        pendingRefreshOptions = mergeRefreshOptions(pendingRefreshOptions, refreshOptions);
        return;
      }
      refreshInFlight = true;
      const epoch = refreshEpoch;
      try {
        const res = await fetchWithTimeout(messagesFetchUrl());
        if (!res.ok) throw new Error("messages unavailable");
        const data = await res.json();
        if (epoch !== refreshEpoch) return;
        const previousEntries = latestPayloadData?.entries || [];
        const previousIds = new Set(previousEntries.map((entry) => entry.context_hash));
        const hasNewAgentMessage = hasInitialRefreshHydrated
          && data.server_instance === currentServerInstance
          && data.entries.some((entry) =>
            entry.context_hash && !previousIds.has(entry.context_hash)
            && entry.sender && entry.sender !== "user" && entry.sender !== "system");
        currentServerInstance = data.server_instance;
        if (data.server_instance !== SERVER_INSTANCE_SEED) {
          setResidentError("server-restarted", "Server restarted; reload");
        }
        latestPayloadData = data;
        if (historyWindow) {
          historyWindow.has_newer = historyWindow.after < data.after;
        }
        render(data, refreshOptions);
        if (hasNewAgentMessage) document.dispatchEvent(new Event("timeline-agent-message"));
        setResidentError("messages-failed", "");
        hasInitialRefreshHydrated = true;
        notifyHubTimelineRenderReady();
      } catch (err) {
        console.error("Messages unavailable", err);
        if (!hasInitialRefreshHydrated) notifyHubTimelineRenderError();
        if (!renderFailed) setResidentError("messages-failed", "Messages unavailable");
      } finally {
        refreshInFlight = false;
        if (pendingRefreshOptions) {
          const nextOptions = pendingRefreshOptions;
          pendingRefreshOptions = null;
          queueMicrotask(() => refresh(nextOptions));
        }
      }
    };
