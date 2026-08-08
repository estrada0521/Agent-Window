    const normalizeSessionStateProjections = (projections) => {
      const raw = Array.isArray(projections)
        ? projections
        : (typeof projections === "string" ? projections.split(",") : []);
      const seen = new Set();
      const ordered = [];
      raw.forEach((item) => {
        const key = String(item || "").trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        ordered.push(key);
      });
      return ordered;
    };
    const mergeSessionStateProjections = (left, right) => {
      const seen = new Set();
      const merged = [];
      [...normalizeSessionStateProjections(left), ...normalizeSessionStateProjections(right)].forEach((item) => {
        if (seen.has(item)) return;
        seen.add(item);
        merged.push(item);
      });
      return merged;
    };
