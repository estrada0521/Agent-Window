    const targetSelectionStorageKey = (label) => `targetSelection:${label || "default"}`;
    const saveTargetSelection = (label, targets) => {
      if (!label) return;
      localStorage.setItem(targetSelectionStorageKey(label), JSON.stringify(targets));
    };
    const loadTargetSelection = (label, availableTargets = []) => {
      if (!label) return [];
      const allowed = new Set(availableTargets);
      return JSON.parse(localStorage.getItem(targetSelectionStorageKey(label)) || "[]")
        .filter((item) => allowed.has(item));
    };
