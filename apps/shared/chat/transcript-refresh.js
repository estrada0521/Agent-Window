    let refreshEpoch = 0;
    const applyLocalEntry = (entry) => {
      refreshEpoch += 1;
      const current = latestPayloadData || {};
      latestPayloadData = { ...current, entries: mergeEntriesById(current.entries || [], [entry]) };
      render(latestPayloadData);
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
        if (data.server_instance !== currentServerInstance) {
          olderEntries = [];
          olderHasMore = false;
          currentServerInstance = data.server_instance;
        }
        if (data.server_instance !== SERVER_INSTANCE_SEED) {
          setResidentStatus("server-restarted", "Server restarted; reload");
        }
        latestPayloadData = data;
        if (!olderEntries.length) {
          olderHasMore = !!data?.has_older;
        }
        render(data, refreshOptions);
        setResidentStatus("messages-failed", "");
        hasInitialRefreshHydrated = true;
        notifyHubChatRenderReady();
      } catch (err) {
        const detail = err?.message || String(err);
        if (!hasInitialRefreshHydrated) notifyHubChatRenderError();
        if (!renderFailed) setResidentStatus("messages-failed", detail);
      } finally {
        refreshInFlight = false;
        if (pendingRefreshOptions) {
          const nextOptions = pendingRefreshOptions;
          pendingRefreshOptions = null;
          queueMicrotask(() => refresh(nextOptions));
        }
      }
    };
