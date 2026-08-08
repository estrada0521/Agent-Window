    const mergeEntriesById = (...groups) => {
      const merged = [];
      const seen = new Set();
      for (const group of groups) {
        for (const rawEntry of (group || [])) {
          const entry = overrideDisplayEntry(rawEntry);
          const msgId = String(entry?.msg_id || "");
          if (msgId) {
            if (seen.has(msgId)) continue;
            seen.add(msgId);
          }
          merged.push(entry);
        }
      }
      return merged;
    };
    const entryRenderKey = (entry) => JSON.stringify([
      String(entry?.msg_id || ""),
      String(entry?.kind || ""),
      String(entry?.deferred_body || ""),
    ]);
    const displayEntriesForData = (data) => {
      const baseEntries = Array.isArray(data?.entries) ? data.entries : [];
      const merged = mergeEntriesById(olderEntries, baseEntries);
      return olderEntries.length ? merged : merged.slice(-INITIAL_MESSAGE_WINDOW);
    };
    const entryTargetsSignature = (entry) => {
      const targets = Array.isArray(entry?.targets) ? entry.targets : [];
      return targets.map((target) => String(target || "").trim().toLowerCase()).filter(Boolean).sort().join("\u001f");
    };
    const entryPeerKey = (sender, targetsSig) => {
      if (!sender || sender === "system") return "";
      const targets = targetsSig ? targetsSig.split("\u001f").filter(Boolean) : [];
      if (sender === "user") {
        return targets.length === 1 ? `peer:${targets[0]}` : `targets:${targetsSig}`;
      }
      return targets.length === 1 && targets[0] === "user"
        ? `peer:${sender}`
        : `sender:${sender}:targets:${targetsSig}`;
    };
    const computeMetaHiddenIds = (entries) => {
      const hiddenIds = new Set();
      let currentPeerKey = "";
      let seenDirectionsForPeer = new Set();
      for (const entry of (entries || [])) {
        const sender = String(entry?.sender || "").trim().toLowerCase();
        const msgId = String(entry?.msg_id || "").trim();
        const targetsSig = entryTargetsSignature(entry);
        if (!sender || sender === "system") {
          continue;
        }
        const peerKey = entryPeerKey(sender, targetsSig);
        if (!peerKey) continue;
        if (peerKey !== currentPeerKey) {
          currentPeerKey = peerKey;
          seenDirectionsForPeer = new Set();
        }
        const directionKey = `${sender}:${targetsSig}`;
        if (seenDirectionsForPeer.has(directionKey) && msgId) {
          hiddenIds.add(msgId);
        } else {
          seenDirectionsForPeer.add(directionKey);
        }
      }
      return hiddenIds;
    };
    const messagesFetchUrl = (extra = {}) => {
      const params = new URLSearchParams();
      params.set("ts", String(Date.now()));
      params.set("limit", String(MESSAGE_BATCH));
      if (isPublicChatView) params.set("light", "1");
      Object.entries(extra || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        params.set(key, String(value));
      });
      return `/messages?${params.toString()}`;
    };
    const emphasizeSystemMessageKeyword = (escapedMessage, kind = "") => {
      const message = String(escapedMessage || "");
      if (!message) return "";
      const kindKey = String(kind || "").trim().toLowerCase();
      const patterns = [];
      if (kindKey === "git-commit") patterns.push(/^Commit\b/i);
      patterns.push(
        /^\/(?:restart|resume|add-agent|remove-agent)\b/i,
        /^(?:Restarted|Resumed|Restart|Resume)\b/i,
        /^(?:Added agent|Removed agent|Add agent|Remove agent)\b/i,
      );
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          return message.replace(pattern, (matched) => `<b>${matched}</b>`);
        }
      }
      return message;
    };
