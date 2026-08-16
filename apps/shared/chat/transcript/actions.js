    const loadOlderMessages = async () => {
      if (olderLoading || !latestPayloadData) return;
      const firstMsgId = displayEntriesForData(latestPayloadData)[0]?.msg_id || "";
      if (!firstMsgId) {
        olderHasMore = false;
        rerenderCurrentMessages();
        return;
      }
      olderLoading = true;
      const prevHeight = timeline.scrollHeight;
      const prevTop = timeline.scrollTop;
      rerenderCurrentMessages();
      try {
        const res = await fetchWithTimeout(messagesFetchUrl({ before_msg_id: firstMsgId }));
        if (!res.ok) throw new Error("older messages unavailable");
        const data = await res.json();
        const olderBatch = Array.isArray(data?.entries) ? data.entries : [];
        olderHasMore = !!data?.has_older;
        if (olderBatch.length) {
          olderEntries = mergeEntriesById(olderBatch, olderEntries);
        }
      } catch (err) {
        setStatus(err?.message || String(err), true);
      } finally {
        olderLoading = false;
        rerenderCurrentMessages({ suppressEntryAnimation: true });
        const delta = timeline.scrollHeight - prevHeight;
        timeline.scrollTop = prevTop + delta;
        updateScrollBtn();
      }
    };
__CHAT_INCLUDE:../transcript-refresh.js__
    timeline.addEventListener("click", async (event) => {
      const fullBtn = event.target.closest("[data-load-full-message]");
      if (fullBtn) {
        event.preventDefault();
        await loadFullMessageEntry(fullBtn.dataset.loadFullMessage || "", fullBtn);
      }
    });
__CHAT_INCLUDE:../slash-commands.js__
    const blurComposerOnMobile = (message) => {
      if (document.documentElement.dataset.mobile === "1") message.blur();
    };
    const postShortcutCommand = async ({ command_id, arg = "" }) => {
      if (sendLocked) {
        return false;
      }
      sendLocked = true;
      const target = selectedTargets.join(",");
      if (!target.trim()) {
        setStatus("select at least one target", true);
        sendLocked = false;
        return false;
      }
      setQuickActionsDisabled(true);
      setStatus(`running ${command_id}...`);
      try {
        const res = await fetch("/shortcut-command", {
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
        if (data.activated) {
          sessionActive = true;
          if (Array.isArray(data.targets) && data.targets.length) {
            availableTargets = normalizedSessionTargets(data.targets);
            selectedTargets = data.targets.filter((t) => availableTargets.includes(t));
            saveTargetSelection(currentSessionName, selectedTargets);
            renderTargetPicker(availableTargets);
          }
          setQuickActionsDisabled(false);
        }
        setStatus(data.status_message || "done");
        void refresh();
        if (data.activated) {
          void refreshSessionState();
        }
        return true;
      } catch (error) {
        setStatus(error.message, true);
        return false;
      } finally {
        setQuickActionsDisabled(!sessionActive);
        sendLocked = false;
      }
    };
    const submitMessage = async ({ closeOverlayOnStart = false, forcedText = null } = {}) => {
      if (sendLocked) {
        return false;
      }
      sendLocked = true;
      const message = document.getElementById("message");
      const rawInput = (forcedText != null ? forcedText : message.value).trim();
      const clearComposerDraft = () => {
        message.value = "";
        updateSendBtnVisibility();
        autoResizeTextarea();
      };
      if (rawInput.startsWith("/")) {
        let list;
        try {
          list = await loadShortcutCommandsOnce();
        } catch (err) {
          setStatus(err?.message || "shortcut commands unavailable", true);
          sendLocked = false;
          return false;
        }
        const parsed = parseSlashCommandInput(rawInput, list);
        if (parsed) {
          const arg = parsed.arg;
          setQuickActionsDisabled(true);
          if (closeOverlayOnStart && isComposerOverlayOpen()) {
            blurComposerOnMobile(message);
            closeComposerOverlay();
          }
          try {
            const res = await fetch("/shortcut-command", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command_id: parsed.id,
                arg,
                target: selectedTargets.join(","),
              }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
              throw new Error(data.error || "shortcut failed");
            }
            if (data.activated) {
              sessionActive = true;
              if (Array.isArray(data.targets) && data.targets.length) {
                availableTargets = normalizedSessionTargets(data.targets);
                selectedTargets = data.targets.filter((t) => availableTargets.includes(t));
                saveTargetSelection(currentSessionName, selectedTargets);
                renderTargetPicker(availableTargets);
              }
              setQuickActionsDisabled(false);
            }
            clearComposerDraft();
            blurComposerOnMobile(message);
            if (pendingAttachments.length) {
              pendingAttachments = [];
              const row = document.getElementById("attachPreviewRow");
              if (row) { row.innerHTML = ""; row.style.display = "none"; }
            }
            closeComposerOverlay();
            setStatus(data.status_message || "done");
            void refresh();
            if (data.activated) {
              void refreshSessionState();
            }
            return true;
          } catch (error) {
            setStatus(error.message, true);
            return false;
          } finally {
            setQuickActionsDisabled(!sessionActive);
            sendLocked = false;
          }
        }
        // ショートカット未一致 → 通常メッセージとして送信
      }
      let target = selectedTargets.join(",");
      const isNote = !target;
      const attachSuffix =
        pendingAttachments.length
          ? pendingAttachments.map((a) => "\n[Attached: " + a.path + "]").join("")
          : "";
      const messageBody = rawInput + attachSuffix;
      if (!messageBody.trim()) {
        setStatus("message is required", true);
        sendLocked = false;
        return false;
      }
      setQuickActionsDisabled(true);
      if (closeOverlayOnStart && isComposerOverlayOpen()) {
        blurComposerOnMobile(message);
        closeComposerOverlay();
      }
      setStatus(isNote ? "saving note..." : `sending to ${target}...`);
      try {
        const res = await fetch("/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target, message: messageBody }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "send failed");
        }
        if (data.activated) {
          sessionActive = true;
          if (Array.isArray(data.targets) && data.targets.length) {
            availableTargets = normalizedSessionTargets(data.targets);
            selectedTargets = data.targets.filter((t) => availableTargets.includes(t));
            saveTargetSelection(currentSessionName, selectedTargets);
            renderTargetPicker(availableTargets);
          }
          setQuickActionsDisabled(false);
        }
        clearComposerDraft();
        blurComposerOnMobile(message);
        if (pendingAttachments.length) {
          pendingAttachments = [];
          const row = document.getElementById("attachPreviewRow");
          if (row) { row.innerHTML = ""; row.style.display = "none"; }
        }
        closeComposerOverlay();
        setStatus(
          isNote
            ? "note saved"
            : (data.queued ? `queued for ${target}` : `sent to ${target}`)
        );
        applyLocalEntry(data.entry);
        if (data.activated) {
          void refreshSessionState();
        }
        return true;
      } catch (error) {
        setStatus(error.message, true);
        return false;
      } finally {
        setQuickActionsDisabled(!sessionActive);
        sendLocked = false;
      }
    };
    document.getElementById("composer").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!canComposeInSession()) {
        setStatus("archived session is read-only", true);
        return;
      }
      const submitter = event.submitter;
      const closeOverlayOnStart = !!(submitter && submitter.classList && submitter.classList.contains("send-btn"));
      await submitMessage({ closeOverlayOnStart });
    });
    const quickMore = document.querySelector(".quick-more");
