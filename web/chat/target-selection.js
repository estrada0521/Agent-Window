    const targetSelectionStorageKey = (session) => `targetSelection:${session || "default"}`;
    const saveTargetSelection = (session, targets) => {
      if (!session) return;
      localStorage.setItem(targetSelectionStorageKey(session), JSON.stringify(targets));
    };
    const loadTargetSelection = (session, availableTargets = []) => {
      if (!session) return [];
      const allowed = new Set(availableTargets);
      return JSON.parse(localStorage.getItem(targetSelectionStorageKey(session)) || "[]")
        .filter((item) => allowed.has(item));
    };
