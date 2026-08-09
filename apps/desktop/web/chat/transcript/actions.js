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
      } catch (_) {
      } finally {
        olderLoading = false;
        rerenderCurrentMessages({ suppressEntryAnimation: true });
        const delta = timeline.scrollHeight - prevHeight;
        timeline.scrollTop = prevTop + delta;
        updateScrollBtn();
      }
    };
__CHAT_INCLUDE:../../../../shared/chat/transcript-refresh.js__
    timeline.addEventListener("click", async (event) => {
      const fullBtn = event.target.closest("[data-load-full-message]");
      if (fullBtn) {
        event.preventDefault();
        await loadFullMessageEntry(fullBtn.dataset.loadFullMessage || "", fullBtn);
      }
    });
__CHAT_INCLUDE:../../../../shared/chat/slash-commands.js__
    const postShortcutCommand = async ({ command_id, arg = "" }) => {
      if (sendLocked || Date.now() - lastSubmitAt < 250) {
        return false;
      }
      sendLocked = true;
      lastSubmitAt = Date.now();
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
      if (sendLocked || Date.now() - lastSubmitAt < 250) {
        return false;
      }
      sendLocked = true;
      lastSubmitAt = Date.now();
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
      const indexOnly = !target;
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
        closeComposerOverlay();
      }
      setStatus(indexOnly ? "saving note..." : `sending to ${target}...`);
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
        if (pendingAttachments.length) {
          pendingAttachments = [];
          const row = document.getElementById("attachPreviewRow");
          if (row) { row.innerHTML = ""; row.style.display = "none"; }
        }
        closeComposerOverlay();
        setStatus(
          indexOnly
            ? "note saved"
            : (data.queued ? `queued for ${target}` : `sent to ${target}`)
        );
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
    const composerPlusMenu = document.getElementById("composerPlusMenu");
    const hubBtn = document.getElementById("hubPageTitleLink");
    const isDesktopHubShell = document.documentElement.dataset.hubShell === "1";
    const isTauriDesktopApp = document.documentElement.dataset.tauriApp === "1";
    const isTauriHubIframeChat = isTauriDesktopApp && document.documentElement.dataset.hubIframeChat === "1";
    const hubHeaderRoot = document.querySelector(".shell > .hub-page-header");
    const hubHeaderTop = hubHeaderRoot?.querySelector(".hub-page-header-top") || null;
    const hubHeaderActions = hubHeaderTop?.querySelector(".hub-page-header-actions") || null;
    const shouldFloatHeaderActions = isDesktopHubShell || (isTauriDesktopApp && !isTauriHubIframeChat);
    if (shouldFloatHeaderActions && hubHeaderActions) {
      if (hubHeaderActions) {
        hubHeaderActions.classList.add("hub-page-header-actions-floating");
        if (hubHeaderActions.parentElement !== document.body) {
          document.body.appendChild(hubHeaderActions);
        }
      }
    }
    if (isDesktopHubShell && hubHeaderRoot && hubHeaderTop) {
      hubHeaderTop.remove();
    }
    if (isTauriHubIframeChat && hubHeaderRoot) {
      hubHeaderRoot.remove();
    }
    hubBtn?.remove();
    let keepComposerPlusMenuOnBlur = false;
    const openHubPath = (path = "/") => {
      const hubHost = window.location.hostname || "127.0.0.1";
      const normalizedPath = String(path || "/").startsWith("/") ? String(path || "/") : `/${String(path || "/")}`;
      const hubUrl = `${window.location.protocol}//${hubHost}:__HUB_PORT__${normalizedPath}`;
      if (window.self !== window.top) {
        if (normalizedPath === "/") {
          window.parent.postMessage({ type: "toggle-hub-sidebar" }, "*");
          return;
        }
        try {
          window.parent.location.href = hubUrl;
          return;
        } catch (_err) {
          window.parent.postMessage({ type: "open-hub-path", url: hubUrl }, "*");
          return;
        }
      }
      window.location.href = hubUrl;
    };
    window.addEventListener("message", (event) => {
      if (!(event.data && event.data.type === "hub-sidebar-state")) return;
      const isOpen = !!event.data.open;
      if (isOpen) document.documentElement.dataset.hubSidebarOpen = "1";
      else delete document.documentElement.dataset.hubSidebarOpen;
    });
    if (!isDesktopHubShell) {
      hubBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        openHubPath("/");
      });
    }
    composerPlusMenu && composerPlusMenu.addEventListener("toggle", () => {
      if (!composerPlusMenu.open) {
        composerPlusMenu.querySelectorAll(".plus-submenu").forEach(sub => { sub.open = false; });
      }
    });
    composerPlusMenu?.addEventListener("pointerdown", () => {
      keepComposerPlusMenuOnBlur = true;
      setTimeout(() => { keepComposerPlusMenuOnBlur = false; }, 240);
    });
    composerPlusMenu?.addEventListener("touchstart", () => {
      keepComposerPlusMenuOnBlur = true;
      setTimeout(() => { keepComposerPlusMenuOnBlur = false; }, 240);
    }, { passive: true });
    composerPlusMenu?.addEventListener("click", (event) => {
      const keepFocusTarget = event.target.closest(".plus-submenu-toggle, .composer-plus-panel .quick-action");
      if (!keepFocusTarget) return;
      if (event.target.closest("#attachBtn")) return;
      requestAnimationFrame(() => {
        if (document.activeElement !== messageInput) {
          focusMessageInputWithoutScroll();
        }
      });
    });
    composerPlusMenu && composerPlusMenu.querySelectorAll(".plus-submenu").forEach(sub => {
      sub.addEventListener("toggle", () => {
        if (sub.open) {
          composerPlusMenu.querySelectorAll(".plus-submenu").forEach(other => {
            if (other !== sub) other.open = false;
          });
        }
      });
    });
    const closePlusMenu = () => {
      if (composerPlusMenu && composerPlusMenu.open) {
        composerPlusMenu.classList.add("closing");
        setTimeout(() => {
          composerPlusMenu.open = false;
          composerPlusMenu.classList.remove("closing");
        }, 160);
      }
    };
    const plusToggle = composerPlusMenu?.querySelector(".composer-plus-toggle");
    plusToggle?.addEventListener("mousedown", (e) => {
      e.preventDefault();
      plusToggle.classList.add("pressing");
    });
    const _clearPressing = () => plusToggle?.classList.remove("pressing");
    plusToggle?.addEventListener("mouseup", _clearPressing);
    plusToggle?.addEventListener("mouseleave", _clearPressing);
    plusToggle?.addEventListener("touchend", _clearPressing, { passive: true });
    plusToggle?.addEventListener("touchcancel", _clearPressing, { passive: true });
    composerPlusMenu?.addEventListener("toggle", () => {
      if (composerPlusMenu.open) closeDrop();
    });
