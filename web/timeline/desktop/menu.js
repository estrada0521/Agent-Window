    const openMenuSelect = (anchor, title, items, onPick) => {
      document.getElementById("menuSelect")?.remove();
      const select = document.createElement("select");
      select.id = "menuSelect";
      select.append(...[{ value: "", label: title, disabled: true }, ...items].map((item) => {
        const node = document.createElement("option");
        node.value = item.value;
        node.textContent = item.label;
        node.disabled = !!item.disabled;
        return node;
      }));
      select.value = "";
      const rect = anchor.getBoundingClientRect();
      select.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;opacity:0.001;z-index:2000;pointer-events:none;`;
      select.addEventListener("change", () => {
        const value = select.value;
        select.remove();
        onPick(value);
      });
      select.addEventListener("blur", () => select.remove());
      document.body.append(select);
      try {
        select.showPicker();
      } catch (_) {
        select.focus({ preventScroll: true });
        select.click();
      }
    };
    const openTimelineMenu = (anchor, payload, onAction) => {
      const agents = { add: payload.addAgents || [], remove: payload.removeAgents || [] };
      openMenuSelect(anchor, "Menu", [
        { value: "add", label: "Add Agent", disabled: !payload.sessionActive || !agents.add.length },
        { value: "remove", label: "Remove Agent", disabled: !payload.sessionActive || !agents.remove.length },
        { value: "pane", label: "tmux pane", disabled: !payload.sessionActive },
        { value: "worktree", label: "Worktree", disabled: payload.worktrees.length < 2 },
        { value: "gitFollow", label: `Follow Mode: ${payload.gitFollow ? "On" : "Off"}` },
        { value: "openShell", label: "Terminal" },
        { value: "openFinder", label: "Finder" },
        { value: "revealLog", label: "Reveal Log" },
        { value: "exportHtml", label: "Export as HTML…" },
        { value: "exportJsonl", label: "Export as JSONL…" },
      ], (action) => {
        if (action === "worktree") {
          openMenuSelect(anchor, "Worktree", payload.worktrees.map((tree) => ({
            value: tree.path,
            label: `${tree.path === payload.gitTree ? "✓ " : ""}${tree.branch}`,
          })), (tree) => onAction({ action: "gitTree", tree }));
          return;
        }
        if (action === "pane") {
          openMenuSelect(anchor, "tmux pane", ["terminal", ...agents.remove].map((target) => ({ value: target, label: target })), (target) => {
            onAction({ action: "openPane", target });
          });
          return;
        }
        if (!agents[action]) {
          onAction({ action });
          return;
        }
        const title = action === "add" ? "Add Agent" : "Remove Agent";
        openMenuSelect(anchor, title, agents[action].map((agent) => ({ value: agent, label: agent })), (agent) => {
          onAction({ action: "agent", mode: action, agent });
        });
      });
    };
