    function normalizeComparableUrl(rawUrl) {
      const value = rawUrl.trim();
      return value ? new URL(value, window.location.href).toString() : "";
    }
    async function reviveTimeline(name) {
      const response = await fetch(`/revive-timeline?timeline=${encodeURIComponent(name)}&format=json`, { method: "POST", cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data.timeline_url;
    }
