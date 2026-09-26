    function normalizeComparableUrl(rawUrl) {
      const value = String(rawUrl || "").trim();
      if (!value) return "";
      try {
        return new URL(value, window.location.href).toString();
      } catch (_) {
        return value;
      }
    }
    function createHubChatUrlResolver(options) {
      const cacheLimit = options.cacheLimit;
      const ttlMs = options.ttlMs || 0;
      const cacheKey = options.cacheKey;
      const wrapUrl = options.wrapUrl;
      const errorMessage = options.errorMessage;
      const cache = new Map();
      const inflight = new Map();
      function write(key, url) {
        const k = String(key || "");
        const value = wrapUrl(url, k);
        if (!k || !value) return "";
        if (cache.has(k)) cache.delete(k);
        cache.set(k, ttlMs ? { url: value, ts: Date.now() } : value);
        while (cache.size > cacheLimit) {
          const oldest = cache.keys().next();
          if (oldest && !oldest.done) cache.delete(oldest.value);
          else break;
        }
        return value;
      }
      function read(key) {
        const k = String(key || "");
        if (!k || !cache.has(k)) return "";
        const item = cache.get(k);
        let value = "";
        if (ttlMs) {
          if ((Date.now() - Number(item?.ts || 0)) > ttlMs) {
            cache.delete(k);
            return "";
          }
          value = wrapUrl(item?.url, k);
        } else {
          value = wrapUrl(item, k);
        }
        if (value) write(k, value);
        return value;
      }
      function forget(key) {
        const k = String(key || "");
        if (!k) return;
        cache.delete(k);
        inflight.delete(k);
      }
      function hasInflight(key) {
        return inflight.has(String(key || ""));
      }
      function resolve(openHref, name, { force = false } = {}) {
        const key = cacheKey(openHref, name);
        if (!force && key) {
          const cached = read(key);
          if (cached) return Promise.resolve(cached);
        }
        const existing = !force && key ? inflight.get(key) : null;
        if (existing) return existing;
        const url = openHref + (openHref.includes("?") ? "&" : "?") + "format=json";
        const request = fetch(url, { cache: "no-store" })
          .then(async (response) => {
            const data = await response.json();
            const chatUrl = String((data && data.chat_url) || "").trim();
            if (!response.ok || !chatUrl) {
              throw new Error((data && data.error) || errorMessage);
            }
            const framed = wrapUrl(chatUrl, name);
            if (key) write(key, framed);
            return framed;
          })
          .finally(() => {
            if (key) inflight.delete(key);
          });
        if (!force && key) inflight.set(key, request);
        return request;
      }
      return { resolve, read, write, forget, hasInflight };
    };
