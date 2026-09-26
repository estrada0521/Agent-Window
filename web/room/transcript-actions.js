    const loadOlderMessages = async () => {
      if (olderLoading || !latestPayloadData) return;
      const loadedCount = displayEntriesForData(latestPayloadData).length;
      if (!loadedCount) {
        olderHasMore = false;
        rerenderCurrentMessages();
        return;
      }
      olderLoading = true;
      const prevHeight = timeline.scrollHeight;
      const prevTop = timeline.scrollTop;
      try {
        const res = await fetchWithTimeout(messagesFetchUrl({ offset: loadedCount }));
        if (!res.ok) throw new Error("older messages unavailable");
        const data = await res.json();
        const olderBatch = Array.isArray(data?.entries) ? data.entries : [];
        olderHasMore = !!data?.has_older;
        if (olderBatch.length) {
          olderEntries = mergeEntriesById(olderBatch, olderEntries);
        }
      } catch (err) {
        setStatus(err?.message || String(err));
      } finally {
        olderLoading = false;
        render(latestPayloadData, { suppressEntryAnimation: true });
        if (!lastRenderPrepended) {
          const delta = timeline.scrollHeight - prevHeight;
          _programmaticScroll = true;
          timeline.scrollTop = prevTop + delta;
          _pollScrollLockTop = timeline.scrollTop;
          queueMicrotask(() => { _programmaticScroll = false; });
        }
        updateScrollBtn();
      }
    };
__INCLUDE:transcript-refresh.js__
    let _shortcutCommandsCache = null;
    const loadShortcutCommandsOnce = async () => {
      if (_shortcutCommandsCache) return _shortcutCommandsCache;
      const r = await fetch("/shortcut-commands", { cache: "no-store" });
      if (!r.ok) throw new Error("shortcut-commands failed");
      const j = await r.json();
      const commands = Array.isArray(j.commands) ? j.commands : [];
      const isMobile = document.documentElement.dataset.mobile === "1";
      const list = commands.filter((command) => isMobile ? !command.desktop_only : !command.mobile_only);
      if (!list.length) throw new Error("empty shortcut commands");
      _shortcutCommandsCache = list;
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
    const applyTimelineActivation = (data) => {
      if (!data?.activated) return;
      roomActive = true;
      if (Array.isArray(data.targets) && data.targets.length) {
        availableTargets = normalizedTimelineTargets(data.targets);
        selectedTargets = data.targets.filter((t) => availableTargets.includes(t));
        saveTargetSelection(currentTimelineLabel, selectedTargets);
        renderTargetPicker(availableTargets);
      }
      syncAgentMenuOptions();
    };
    const postShortcutCommand = async ({
      command_id,
      arg = "",
      path = "/shortcut-command",
      target = selectedTargets.join(","),
    }) => {
      if (sendLocked) {
        return false;
      }
      sendLocked = true;
      if (!target.trim() && command_id !== "openpane") {
        setStatus("No target");
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
          throw new Error(data.error || "shortcut failed");
        }
        applyTimelineActivation(data);
        void refresh();
        if (data.activated) {
          void refreshRoomState();
        }
        return true;
      } catch (error) {
        setStatus(error.message);
        return false;
      } finally {
        sendLocked = false;
      }
    };
    const submitMessage = async ({ closeOverlayOnStart = false, forcedText = null } = {}) => {
      if (sendLocked) {
        return false;
      }
      if (attachUploadsInFlight > 0) {
        setStatus("Still uploading");
        return false;
      }
      sendLocked = true;
      const message = document.getElementById("message");
      const rawInput = forcedText != null ? forcedText : message.value;
      const commandInput = rawInput.trim();
      const clearComposerDraft = () => {
        message.value = "";
        clearStoredComposerDraft();
        updateSendBtnVisibility();
        autoResizeTextarea();
      };
      if (commandInput.startsWith("/")) {
        let list;
        try {
          list = await loadShortcutCommandsOnce();
        } catch (err) {
          setStatus(err?.message || "Commands unavailable");
          sendLocked = false;
          return false;
        }
        const parsed = parseSlashCommandInput(commandInput, list);
        if (parsed) {
          if (parsed.insert) {
            message.value = parsed.insert + " ";
            updateSendBtnVisibility();
            autoResizeTextarea();
            focusMessageInputWithoutScroll(message.value.length);
            sendLocked = false;
            return false;
          }
          const arg = parsed.arg;
          if (closeOverlayOnStart && isComposerOverlayOpen()) {
            blurComposerOnMobile(message);
            document.documentElement.dataset.sendInFlight = "1";
            closeComposerOverlay();
          }
          setStatus("");
          try {
            const res = await fetch(parsed.path || "/shortcut-command", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command_id: parsed.id,
                arg,
                target: parsed.id === "terminal" ? "terminal" : selectedTargets.join(","),
              }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
              throw new Error(data.error || "shortcut failed");
            }
            applyTimelineActivation(data);
            clearComposerDraft();
            blurComposerOnMobile(message);
            if (pendingAttachments.length) {
              pendingAttachments = [];
              const row = document.getElementById("attachPreviewRow");
              if (row) { row.innerHTML = ""; row.style.display = "none"; }
            }
            updateSendBtnVisibility();
            closeComposerOverlay();
            void refresh();
            if (data.activated) {
              void refreshRoomState();
            }
            return true;
          } catch (error) {
            setStatus(error.message);
            document.dispatchEvent(new CustomEvent("room-send-failed"));
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
        setStatus("Empty message");
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
        applyTimelineActivation(data);
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
        if (data.activated) {
          void refreshRoomState();
        }
        return true;
      } catch (error) {
        setStatus(error.message);
        document.dispatchEvent(new CustomEvent("room-send-failed"));
        return false;
      } finally {
        sendLocked = false;
        delete document.documentElement.dataset.sendInFlight;
      }
    };
    document.getElementById("composer").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!canComposeInRoom()) return;
      const submitter = event.submitter;
      const closeOverlayOnStart = !!(submitter && submitter.classList && submitter.classList.contains("send-btn"));
      await submitMessage({ closeOverlayOnStart });
    });
