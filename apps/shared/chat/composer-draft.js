    const composerDraftStorageKey = (session) => `agent_window_composer_draft:${session}`;
    const composerDraftSessionKey = () => {
      const named = String(currentSessionName || "").trim();
      if (named) return named;
      const match = String(window.location.pathname || "").match(/\/session\/([^/]+)/);
      if (!match) return "";
      try {
        return decodeURIComponent(match[1]);
      } catch (_) {
        return match[1];
      }
    };
    let composerDraftRestoredFor = "";
    const saveComposerDraft = () => {
      const session = composerDraftSessionKey();
      const input = document.getElementById("message");
      if (!session || !input) return;
      const text = String(input.value || "");
      try {
        if (text) localStorage.setItem(composerDraftStorageKey(session), text);
        else localStorage.removeItem(composerDraftStorageKey(session));
      } catch (_) {}
    };
    const clearStoredComposerDraft = () => {
      const session = composerDraftSessionKey();
      if (!session) return;
      try {
        localStorage.removeItem(composerDraftStorageKey(session));
      } catch (_) {}
    };
    const restoreComposerDraft = () => {
      const session = composerDraftSessionKey();
      const input = document.getElementById("message");
      if (!session || !input) return;
      if (composerDraftRestoredFor === session) return;
      if (input.value) {
        composerDraftRestoredFor = session;
        saveComposerDraft();
        return;
      }
      let saved = "";
      try {
        saved = String(localStorage.getItem(composerDraftStorageKey(session)) || "");
      } catch (_) {
        saved = "";
      }
      composerDraftRestoredFor = session;
      if (!saved) return;
      input.value = saved;
      if (typeof updateSendBtnVisibility === "function") updateSendBtnVisibility();
      if (typeof autoResizeTextarea === "function") autoResizeTextarea();
    };
