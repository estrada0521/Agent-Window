    const renderTargetPicker = (targets) => {
      const root = document.getElementById("targetPicker");
      root.classList.toggle("target-picker-readonly", !canComposeInSession());
      const selectedSet = new Set(selectedTargets);
      const targetsSig = JSON.stringify(targets);
      const selectionSig = JSON.stringify([...selectedSet].sort());
      const renderSig = `${targetsSig}|${selectionSig}`;
      if (root.dataset.renderSig === renderSig) return;

      if (root.dataset.targetsSig !== targetsSig) {
        root.dataset.targetsSig = targetsSig;
        root.innerHTML = targets.map((target) => {
          return `<button type="button" class="target-chip" data-target="${target}" data-base-agent="${agentBaseName(target)}" title="${escapeHtml(target)}"><span class="agent-icon-slot agent-icon-slot--chip"><span class="target-icon" aria-hidden="true" style="--agent-icon-mask:url('${escapeHtml(agentIconSrc(target))}')"></span>${agentIconInstanceSubHtml(target)}</span></button>`;
        }).join("");
        root.querySelectorAll(".target-chip").forEach((node) => {
          node.addEventListener("mousedown", (e) => e.preventDefault());
          node.addEventListener("click", () => {
            if (!canComposeInSession()) return;
            const target = node.dataset.target;
            if (selectedTargets.includes(target)) {
              selectedTargets = selectedTargets.filter((item) => item !== target);
            } else {
              selectedTargets = [...selectedTargets, target];
            }
            saveTargetSelection(currentSessionName, selectedTargets);
            renderTargetPicker(availableTargets);
          });
        });
      }
      root.querySelectorAll(".target-chip").forEach((node) => {
        node.classList.toggle("active", selectedSet.has(node.dataset.target));
      });
      root.dataset.renderSig = renderSig;
      syncTargetPickerFade();
    };
    const syncTargetPickerFade = () => {
      const el = document.getElementById("targetPicker");
      if (!el) return;
      const width = el.clientWidth;
      const max = el.scrollWidth - width;
      const fadeLeft = width > 0 && el.scrollLeft > 1;
      const fadeRight = width > 0 && max > 1 && el.scrollLeft < max - 1;
      el.style.setProperty("--target-picker-fade-left", fadeLeft ? "16px" : "0px");
      el.style.setProperty("--target-picker-fade-right", fadeRight ? "16px" : "0px");
      el.style.maskImage = fadeLeft || fadeRight ? "" : "none";
      el.style.webkitMaskImage = fadeLeft || fadeRight ? "" : "none";
    };
    {
      const el = document.getElementById("targetPicker");
      if (el) {
        el.addEventListener("scroll", syncTargetPickerFade, { passive: true });
        if (typeof ResizeObserver === "function") new ResizeObserver(syncTargetPickerFade).observe(el);
      }
    }
    window.addEventListener("keydown", (event) => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.isComposing || event.keyCode === 229 || event.repeat) return;
      const match = /^Digit([1-9])$/.exec(event.code || "");
      if (!match || !canComposeInSession()) return;
      const chips = document.querySelectorAll("#targetPicker .target-chip");
      const chip = chips[Number(match[1]) - 1];
      if (!chip) return;
      event.preventDefault();
      chip.click();
    }, true);
