    const terminalCommandSlash = "/terminal";
    const composerDraftStorageKey = (label) => `agent_window_composer_draft:${label}`;
    let composerDraftRestoredFor = "";
    const saveComposerDraft = () => {
      const label = currentTimelineName;
      const input = document.getElementById("message");
      if (!label || !input) return;
      const text = isTerminalMode() && input.value ? `${terminalCommandSlash} ${input.value}` : input.value;
      if (!text) {
        localStorage.removeItem(composerDraftStorageKey(label));
        return;
      }
      try {
        localStorage.setItem(composerDraftStorageKey(label), text);
      } catch (err) {
        setStatus(`Draft not saved: ${err.message}`);
      }
    };
    const clearStoredComposerDraft = () => {
      if (!currentTimelineName) return;
      localStorage.removeItem(composerDraftStorageKey(currentTimelineName));
    };
    const restoreComposerDraft = () => {
      const label = currentTimelineName;
      const input = document.getElementById("message");
      if (!label || !input) return;
      if (composerDraftRestoredFor === label) return;
      if (input.value) {
        composerDraftRestoredFor = label;
        saveComposerDraft();
        return;
      }
      const saved = localStorage.getItem(composerDraftStorageKey(label));
      composerDraftRestoredFor = label;
      if (!saved) return;
      const terminalDraft = document.documentElement.dataset.mobile === "1" && saved.startsWith(terminalCommandSlash + " ");
      input.value = terminalDraft ? saved.slice(terminalCommandSlash.length + 1) : saved;
      if (terminalDraft) setTerminalMode(true);
      if (typeof updateSendBtnVisibility === "function") updateSendBtnVisibility();
      queueMicrotask(() => autoResizeTextarea());
    };
