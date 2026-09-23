    const composerDraftStorageKey = (session) => `agent_window_composer_draft:${session}`;
    let composerDraftRestoredFor = "";
    const saveComposerDraft = () => {
      const session = currentSessionName;
      const input = document.getElementById("message");
      if (!session || !input) return;
      const text = input.value;
      if (!text) {
        localStorage.removeItem(composerDraftStorageKey(session));
        return;
      }
      try {
        localStorage.setItem(composerDraftStorageKey(session), text);
      } catch (err) {
        setStatus(`draft not saved: ${err.message}`, true);
      }
    };
    const clearStoredComposerDraft = () => {
      if (!currentSessionName) return;
      localStorage.removeItem(composerDraftStorageKey(currentSessionName));
    };
    const restoreComposerDraft = () => {
      const session = currentSessionName;
      const input = document.getElementById("message");
      if (!session || !input) return;
      if (composerDraftRestoredFor === session) return;
      if (input.value) {
        composerDraftRestoredFor = session;
        saveComposerDraft();
        return;
      }
      const saved = localStorage.getItem(composerDraftStorageKey(session));
      composerDraftRestoredFor = session;
      if (!saved) return;
      input.value = saved;
      if (typeof updateSendBtnVisibility === "function") updateSendBtnVisibility();
      if (typeof autoResizeTextarea === "function") autoResizeTextarea();
    };
