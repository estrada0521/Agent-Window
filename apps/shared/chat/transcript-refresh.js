    let refreshEpoch = 0;
    const applyLocalEntry = (entry) => {
      const contextHash = String(entry?.context_hash || "").trim();
      if (!contextHash) throw new Error("send did not return entry");
      refreshEpoch += 1;
      const current = latestPayloadData || {};
      latestPayloadData = { ...current, entries: mergeEntriesById(current.entries || [], [entry]) };
      render(latestPayloadData);
      notifyHubMessagesChanged();
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
        const url = messagesFetchUrl();
        const headers = {};
        if (lastMessagesEtag) {
          headers["If-None-Match"] = lastMessagesEtag;
        }
        const res = await fetchWithTimeout(
          url,
          Object.keys(headers).length ? { headers } : {}
        );
        if (res.status === 304) {
          if (!hasInitialRefreshHydrated) {
            hasInitialRefreshHydrated = true;
            releaseLaunchShellGate();
          }
          notifyHubChatRenderReady();
          return;
        }
        if (!res.ok) throw new Error("messages unavailable");
        const nextMessagesEtag = res.headers.get("ETag") || "";
        if (nextMessagesEtag) {
          lastMessagesEtag = nextMessagesEtag;
        }
        const data = await res.json();
        if (epoch !== refreshEpoch) return;
        const nextServerInstance = data?.server_instance || "";
        if (nextServerInstance && currentServerInstance && nextServerInstance !== currentServerInstance) {
          olderEntries = [];
          olderHasMore = false;
        }
        if (nextServerInstance) currentServerInstance = nextServerInstance;
        latestPayloadData = data;
        if (!olderEntries.length) {
          olderHasMore = !!data?.has_older;
        }
        render(data, refreshOptions);
        if (!hasInitialRefreshHydrated) {
          hasInitialRefreshHydrated = true;
          releaseLaunchShellGate();
        }
        notifyHubChatRenderReady();
        notifyHubMessagesChanged();
      } catch (err) {
        const detail = err?.message || String(err);
        if (!hasInitialRefreshHydrated) {
          releaseLaunchShellGate();
          notifyHubChatRenderError(detail);
        }
        setStatus(detail, true);
      } finally {
        refreshInFlight = false;
        if (pendingRefreshOptions) {
          const nextOptions = pendingRefreshOptions;
          pendingRefreshOptions = null;
          queueMicrotask(() => refresh(nextOptions));
        }
      }
    };
