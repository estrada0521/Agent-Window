    const loadOlderMessages = async ({ limit = MESSAGE_BATCH } = {}) => {
      if (!latestPayloadData || historyLoading) return;
      if (!historyWindow) historyWindow = { ...latestPayloadData };
      await loadHistoryPage(true, limit);
    };
__INCLUDE:transcript-refresh.js__
    const loadHistoryPage = async (before, limit = MESSAGE_BATCH) => {
      if (!historyWindow || historyLoading) return;
      historyLoading = true;
      const current = historyWindow;
      clearPollScrollLock();
      if (before) {
        messagesEl.style.scrollbarGutter = "stable";
        messagesEl.style.overflowY = "hidden";
      }
      const top = messagesEl.scrollTop;
      const height = messagesEl.scrollHeight;
      try {
        const res = await fetchWithTimeout(messagesFetchUrl({ cursor: before ? current.before : current.after, direction: before ? "before" : "after", limit }));
        if (!res.ok) throw new Error("History unavailable");
        const data = await res.json();
        if (historyWindow !== current) return;
        current.entries = before ? [...data.entries, ...current.entries] : [...current.entries, ...data.entries];
        if (before) {
          current.before = data.before;
          current.has_older = data.has_older;
        } else {
          current.after = data.after;
          current.has_newer = data.has_newer;
        }
        _stickyToBottom = false;
        render(latestPayloadData, { suppressEntryAnimation: true });
        _programmaticScroll = true;
        messagesEl.scrollTop = top + (before ? messagesEl.scrollHeight - height : 0);
        queueMicrotask(() => { _programmaticScroll = false; });
      } catch (error) {
        if (historyWindow === current) setError("History unavailable", error);
      } finally {
        if (before) {
          messagesEl.style.removeProperty("overflow-y");
          messagesEl.style.removeProperty("scrollbar-gutter");
        }
        if (historyWindow === current) historyLoading = false;
      }
    };
    const jumpToDate = async (date) => {
      if (!date) throw new Error("Invalid date");
      const res = await fetchWithTimeout(messagesFetchUrl({ at: date }), {}, 15000);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showHistoryWindow(data);
    };
    const showHistoryWindow = (data) => {
      refreshEpoch += 1;
      historyWindow = data;
      historyLoading = true;
      clearPollScrollLock();
      _stickyToBottom = false;
      render(latestPayloadData, { forceFullRender: true, suppressEntryAnimation: true });
      clearPollScrollLock();
      requestAnimationFrame(() => {
        const row = messagesEl.querySelector("[data-context-hash]");
        if (row) positionConversationRowAtStepTop(row, "auto");
        historyLoading = false;
        updateScrollBtn();
      });
    };
    let _slashCommandsCache = null;
    const loadSlashCommandsOnce = async () => {
      if (_slashCommandsCache) return _slashCommandsCache;
      const r = await fetch("/slash-commands", { cache: "no-store" });
      if (!r.ok) throw new Error("Slash commands failed");
      const j = await r.json();
      const commands = Array.isArray(j.commands) ? j.commands : [];
      const isMobile = document.documentElement.dataset.mobile === "1";
      const list = commands.filter((command) => isMobile ? !command.desktop_only : !command.mobile_only);
      if (!list.length) throw new Error("No slash commands");
      _slashCommandsCache = list;
      return list;
    };
    const parseSlashCommandInput = (rawInput, list) => {
      const normalized = rawInput.trim();
      const sorted = [...list].sort((a, b) => String(b.slash || "").length - String(a.slash || "").length);
      for (const c of sorted) {
        const slash = String(c.slash || "");
        if (!slash.startsWith("/")) continue;
        if (normalized === slash) {
          return { id: c.id, arg: "", path: c.path, insert: c.insert || "" };
        }
        if (c.has_arg && normalized.startsWith(slash + " ")) {
          return { id: c.id, arg: normalized.slice(slash.length + 1), path: c.path };
        }
      }
      return null;
    };

    const blurComposerOnMobile = (message) => {
      if (document.documentElement.dataset.mobile === "1") message.blur();
    };
    const postAgentCommand = async ({
      command_id,
      arg = "",
      path = "/key-macro",
      target = selectedTargets.join(","),
    }) => {
      if (sendLocked) {
        return false;
      }
      sendLocked = true;
      if (!target.trim() && command_id !== "openpane") {
        setError("No target");
        sendLocked = false;
        return false;
      }
      setStatus("");
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command_id,
            arg,
            target,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Command failed");
        }
        void refresh();
        return true;
      } catch (error) {
        setError("Command failed", error);
        return false;
      } finally {
        sendLocked = false;
      }
    };
    const isTerminalMode = () => composerForm.classList.contains("terminal-mode");
    const setTerminalMode = (on) => {
      composerForm.classList.toggle("terminal-mode", on);
      document.body.classList.toggle("composer-terminal-mode", on);
      const attachButton = document.getElementById("attachBtn");
      attachButton.setAttribute("aria-label", on ? "Exit Terminal mode" : "Import");
      attachButton.title = on ? "Exit Terminal mode" : "Import";
      messageInput.placeholder = on ? "Type into Terminal" : "Write a message";
      updateSendBtnVisibility();
    };
    const submitMessage = async ({ closeOverlayOnStart = false, forcedText = null } = {}) => {
      if (sendLocked) {
        return false;
      }
      if (attachUploadsInFlight > 0) {
        setError("Still uploading");
        return false;
      }
      sendLocked = true;
      const message = document.getElementById("message");
      const rawInput = forcedText != null ? forcedText : message.value;
      const terminalMode = forcedText == null && isTerminalMode();
      if (terminalMode && pendingAttachments.length) {
        setError("Remove attachments");
        sendLocked = false;
        return false;
      }
      if (terminalMode && !rawInput.trim()) {
        setError("Empty Terminal input");
        sendLocked = false;
        return false;
      }
      const commandInput = terminalMode ? `${terminalCommandSlash} ${rawInput.trim()}` : rawInput.trim();
      const clearComposerDraft = () => {
        message.value = "";
        clearStoredComposerDraft();
        updateSendBtnVisibility();
        autoResizeTextarea();
      };
      if (commandInput.startsWith("/")) {
        let list;
        try {
          list = await loadSlashCommandsOnce();
        } catch (err) {
          setError("Commands unavailable", err);
          sendLocked = false;
          return false;
        }
        const parsed = parseSlashCommandInput(commandInput, list);
        if (parsed) {
          if (parsed.id === "search") {
            clearComposerDraft();
            beginSearch();
            sendLocked = false;
            return false;
          }
          if (parsed.id === "jump") {
            try {
              await jumpToDate(parsed.arg);
              clearComposerDraft();
              blurComposerOnMobile(message);
              closeComposerOverlay();
            } catch (error) {
              setError(error.message === "Invalid date" || error.message === "No earlier messages" ? error.message : "Jump failed", error);
            } finally {
              sendLocked = false;
            }
            return false;
          }
          if (parsed.insert) {
            message.value = parsed.insert + " ";
            updateSendBtnVisibility();
            autoResizeTextarea();
            focusMessageInputWithoutScroll(message.value.length);
            sendLocked = false;
            return false;
          }
          const arg = parsed.arg;
          const target = parsed.id === "terminal" ? "terminal" : selectedTargets.join(",");
          if (!target.trim() && parsed.id !== "openpane") {
            setError("No target");
            sendLocked = false;
            return false;
          }
          if (closeOverlayOnStart && isComposerOverlayOpen()) {
            blurComposerOnMobile(message);
            document.documentElement.dataset.sendInFlight = "1";
            closeComposerOverlay();
          }
          setStatus("");
          try {
            const res = await fetch(parsed.path, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command_id: parsed.id,
                arg,
                target,
              }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
              throw new Error(data.error || "Command failed");
            }
            clearComposerDraft();
            if (terminalMode) {
              setTerminalMode(false);
              autoResizeTextarea();
            }
            blurComposerOnMobile(message);
            if (pendingAttachments.length) {
              pendingAttachments = [];
              const row = document.getElementById("attachPreviewRow");
              if (row) { row.innerHTML = ""; row.style.display = "none"; }
            }
            updateSendBtnVisibility();
            closeComposerOverlay();
            if (parsed.id === "terminal" && document.documentElement.dataset.mobile === "1") {
              showPaneTraceViewer("terminal");
            }
            void refresh();
            return true;
          } catch (error) {
            setError("Command failed", error);
            document.dispatchEvent(new CustomEvent("timeline-send-failed"));
            return false;
          } finally {
            sendLocked = false;
            delete document.documentElement.dataset.sendInFlight;
          }
        }
      }
      let target = selectedTargets.join(",");
      const isNote = !target;
      const attachSuffix =
        pendingAttachments.length
          ? pendingAttachments.map((a) => "\n`" + a.path + "`").join("")
          : "";
      const messageBody = rawInput + attachSuffix;
      if (!messageBody.trim()) {
        setError("Empty message");
        sendLocked = false;
        return false;
      }
      if (isComposerOverlayOpen()) {
        document.documentElement.dataset.sendInFlight = "1";
        if (closeOverlayOnStart) {
          blurComposerOnMobile(message);
          closeComposerOverlay();
        }
      }
      setStatus("");
      try {
        const res = await fetch("/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target,
            message: messageBody,
            client: document.documentElement.dataset.mobile === "1" ? "mobile" : "desktop",
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "send failed");
        }
        clearComposerDraft();
        blurComposerOnMobile(message);
        if (pendingAttachments.length) {
          pendingAttachments = [];
          const row = document.getElementById("attachPreviewRow");
          if (row) { row.innerHTML = ""; row.style.display = "none"; }
        }
        updateSendBtnVisibility();
        closeComposerOverlay();
        if (!isNote) {
          for (const t of selectedTargets) {
            if (agentBaseName(t) !== "user") markAgentOptimisticallyRunning(t);
          }
        }
        applyLocalEntry(data.entry);
        return true;
      } catch (error) {
        setError("Send failed", error);
        document.dispatchEvent(new CustomEvent("timeline-send-failed"));
        return false;
      } finally {
        sendLocked = false;
        delete document.documentElement.dataset.sendInFlight;
      }
    };
    document.getElementById("composer").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!canCompose()) return;
      const submitter = event.submitter;
      const closeOverlayOnStart = !!(submitter && submitter.classList && submitter.classList.contains("send-btn"));
      await submitMessage({ closeOverlayOnStart });
    });
