    const composerDraftStorageKey = (label) => `agent_window_composer_draft:${label}`;
    let composerDraftRestoredFor = "";
    const saveComposerDraft = () => {
      const label = currentTimelineLabel;
      const input = document.getElementById("message");
      if (!label || !input) return;
      const text = input.value;
      if (!text) {
        localStorage.removeItem(composerDraftStorageKey(label));
        return;
      }
      try {
        localStorage.setItem(composerDraftStorageKey(label), text);
      } catch (err) {
        setStatus(`draft not saved: ${err.message}`);
      }
    };
    const clearStoredComposerDraft = () => {
      if (!currentTimelineLabel) return;
      localStorage.removeItem(composerDraftStorageKey(currentTimelineLabel));
    };
    const restoreComposerDraft = () => {
      const label = currentTimelineLabel;
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
      input.value = saved;
      if (typeof updateSendBtnVisibility === "function") updateSendBtnVisibility();
      if (typeof autoResizeTextarea === "function") autoResizeTextarea();
    };
