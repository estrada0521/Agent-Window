    const purgeChatAssetCaches = async () => {
      if (!("caches" in window)) return;
      const baseUrl = `${window.location.origin}${CHAT_BASE_PATH || ""}`;
      const exactUrls = new Set([
        `${baseUrl}/app.webmanifest`,
        `${baseUrl}/pwa-icon-192.png`,
        `${baseUrl}/pwa-icon-512.png`,
        `${baseUrl}/apple-touch-icon.png`,
      ]);
      const prefixUrls = [
        `${baseUrl}/chat-assets/`,
      ];
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(async (cacheName) => {
          const cache = await caches.open(cacheName);
          const requests = await cache.keys();
          await Promise.all(requests.map((request) => {
            const url = String(request?.url || "");
            if (exactUrls.has(url) || prefixUrls.some((prefix) => url.startsWith(prefix))) {
              return cache.delete(request);
            }
            return Promise.resolve(false);
          }));
        }));
      } catch (_) {}
    };
    const refreshChatServiceWorkers = async () => {
      if (!("serviceWorker" in navigator)) return;
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));
      } catch (_) {}
    };
    const waitForChatReady = async (timeoutMs = 15000, expectedPreviousInstance = "") => {
      const deadline = Date.now() + timeoutMs;
      let sawDisconnect = false;
      while (Date.now() < deadline) {
        try {
          const sessionRes = await fetchWithTimeout(`/session-state?ts=${Date.now()}`, {}, 3500);
          if (sessionRes.ok) {
            const sessionData = await sessionRes.json();
            const instance = sessionData?.server_instance || "";
            const instanceAdvanced = !expectedPreviousInstance || (instance && instance !== expectedPreviousInstance) || sawDisconnect;
            if (instanceAdvanced) {
              const messagesRes = await fetchWithTimeout(messagesFetchUrl({ limit: 1 }), {}, 3500);
              if (messagesRes.ok) {
                const messagesData = await messagesRes.json();
                if (Array.isArray(messagesData?.entries)) {
                  const liveInstance = messagesData?.server_instance || instance;
                  if (liveInstance) currentServerInstance = liveInstance;
                  return true;
                }
              }
            }
          }
        } catch (_) {
          sawDisconnect = true;
        }
        await sleep(250);
      }
      return false;
    };
    const navigateToFreshChat = () => {
      const params = new URLSearchParams(window.location.search);
      params.set("follow", followMode ? "1" : "0");
      params.set("launch_shell", "1");
      params.set("ts", String(Date.now()));
      window.location.replace(`${window.location.pathname}?${params.toString()}`);
    };
