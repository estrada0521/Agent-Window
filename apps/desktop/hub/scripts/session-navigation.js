
    async function pickWorkspaceForNewSession() {
      const nativePickerSupported =
        /mac/i.test(String(navigator.platform || "")) &&
        !/iphone|ipad|ipod|android/i.test(String(navigator.userAgent || ""));
      if (!nativePickerSupported) {
        const manual = window.prompt("Workspace path", "");
        return manual === null ? "" : String(manual || "").trim();
      }
      const res = await fetch("/pick-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.path) return String(data.path || "");
      if (data.canceled) return "";
      throw new Error(data.error || "Workspace picker failed.");
    }

    async function startDeskNewSessionFlow() {
      if (_deskNewSessionStarting) return;
      _deskNewSessionStarting = true;
      _deskNewSessionToggle?.classList.add("archived");
      showDeskHubMessage();
      try {
        const workspace = await pickWorkspaceForNewSession();
        if (!workspace) return;
        const res = await fetch("/start-session-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok || !data.chat_url) {
          throw new Error(data.error || "Failed to open draft session.");
        }
        openChatInDesk(data.chat_url, data.session || "");
        showDeskHubMessage(data.notice || "", { error: !!data.notice });
        // Leave the sidebar however it was -- New Session is reachable with it
        // closed (⌘N). Phone still dismisses its overlay so the new chat shows.
        if (isPhoneViewport()) {
          setDeskSidebarOpen(false);
        }
        void refreshHubSessions(true, { skipRestore: true });
      } catch (err) {
        showDeskHubMessage(err?.message || "Failed to open draft session.", { error: true });
      } finally {
        _deskNewSessionStarting = false;
        _deskNewSessionToggle?.classList.remove("archived");
      }
    }

    // One persistent iframe is reused for every session. Assigning `.src` is a
    // navigation that appends an entry to the Hub's joint session history, and
    // WebKit then keeps the whole outgoing chat Document resident (bfcache) so
    // "back" would be instant -- measured at ~+150 MB per switch, never freed.
    // location.replace() navigates without adding a history entry (verified to
    // work even though the chat frame is a cross-origin per-session origin), so
    // the outgoing Document has no entry pinning it and can be torn down.
    function navigateDeskChatFrame(url) {
      const target = String(url || "") || "about:blank";
      _deskChatFrameLoadedUrl = target === "about:blank" ? "" : target;
      const win = _deskChatFrame && _deskChatFrame.contentWindow;
      if (win) {
        try {
          win.location.replace(target);
          return;
        } catch (_) {
          // detached document -- fall back to an attribute navigation
        }
      }
      if (_deskChatFrame) _deskChatFrame.src = target;
    }

    function clearDeskChatFrame() {
      navigateDeskChatFrame("about:blank");
      setDeskChatLoading(false);
    }

    function clearDeskSelection() {
      _deskOpenToken += 1;
      _deskSelectedSessionName = "";
      updateDeskWindowTitle("");
      persistDeskSelection("");
      setDeskSelectionInUrl("");
      clearDeskChatFrame();
      applyDeskSessionSelection();
    }

    function openChatInDesk(url, name) {
      if (!_deskChatFrame) return;
      _deskSelectedSessionName = name || "";
      _deskUnreadSessions.delete(_deskSelectedSessionName);
      updateDeskWindowTitle(_deskSelectedSessionName);
      persistDeskSelection(_deskSelectedSessionName);
      setDeskSelectionInUrl(_deskSelectedSessionName);
      if (isDeskSessionSidebarOpen()) _deskChatFrame.dataset.hubSidebarOpen = "1";
      else delete _deskChatFrame.dataset.hubSidebarOpen;
      if (_deskSelectedSessionName) {
        cacheDeskChatUrl(buildSessionOpenHref(_deskSelectedSessionName, false), url);
      }
      const frameUrl = buildDeskChatFrameUrl(url);
      if (frameUrl) {
        const currentUrl = normalizeComparableUrl(_deskChatFrameLoadedUrl);
        const nextUrl = normalizeComparableUrl(frameUrl);
        if (!currentUrl || currentUrl !== nextUrl) {
          setDeskChatLoading(true);
          navigateDeskChatFrame(frameUrl);
        } else {
          setDeskChatLoading(false);
        }
      } else {
        setDeskChatLoading(false);
      }
      applyDeskSessionSelection();
    }

    function resolveSessionChatUrl(openHref, { force = false } = {}) {
      return hubChatUrls.resolve(openHref, "", { force });
    }

    async function openSessionFrame(openHref, name) {
      if (!name) {
        failDeskOpen("Session not found");
        return;
      }
      const needsReviveTransition = /^\/revive-session(?:[/?]|$)/.test(String(openHref || ""));
      const openFailed = !!_deskReloadShell?.classList.contains("visible");
      if (!needsReviveTransition && name === _deskSelectedSessionName && !openFailed) return;
      setDeskReloadShell(false);
      const archived = !!findSessionRecord(name)?.archived;
      const closeOnOpen = isPhoneViewport();
      _deskSelectedSessionName = name;
      updateDeskWindowTitle(name);
      persistDeskSelection(name);
      setDeskSelectionInUrl(name);
      applyDeskSessionSelection();
      setDeskChatLoading(true);
      const openToken = ++_deskOpenToken;
      try {
        // Only one archived chat server remains alive. Opening another archived
        // session stops the previous one, so its cached URL cannot be reused.
        const chatUrl = await resolveSessionChatUrl(openHref, { force: archived || needsReviveTransition });
        if (openToken !== _deskOpenToken) return;
        if (needsReviveTransition) {
          await refreshHubSessions(true, { skipRestore: true });
          if (openToken !== _deskOpenToken) return;
        }
        openChatInDesk(chatUrl, name);
        if (closeOnOpen) setDeskSidebarOpen(false);
      } catch (err) {
        if (openToken !== _deskOpenToken) return;
        failDeskOpen(err?.message || "open session failed");
      }
    }

    function getDeskSessionRows() {
      if (!_deskSessionList) return [];
      return Array.from(_deskSessionList.querySelectorAll(".desk-session-row[data-open-href][data-session-name]"))
        .filter((row) => row && row.getClientRects().length > 0);
    }

    function focusDeskSessionRow(row) {
      if (!row) return;
      try {
        row.focus({ preventScroll: true });
      } catch (_) {
        try { row.focus(); } catch (_) {}
      }
      try {
        row.scrollIntoView({ block: "nearest" });
      } catch (_) {}
    }

    function focusDeskSessionByName(name) {
      if (!_deskSessionList || !name) return;
      const row = _deskSessionList.querySelector(`.desk-session-row[data-session-name="${cssEsc(name)}"]`);
      focusDeskSessionRow(row);
    }

    function deskSessionOpenHref(row) {
      const name = row?.dataset.sessionName || "";

      return row?.dataset.openHref || "";
    }

    function openDeskSessionRow(row) {
      if (!row) return false;
      const href = deskSessionOpenHref(row);
      const name = row.dataset.sessionName || "";
      if (!href || !name) return false;
      openSessionFrame(href, name);
      requestAnimationFrame(() => focusDeskSessionByName(name));
      return true;
    }

    function moveDeskSessionSelection(direction, fromRow = null, fromEdge = "") {
      const rows = getDeskSessionRows();
      if (!rows.length) return false;
      let index = -1;
      if (fromEdge === "after") {
        index = rows.length;
      } else if (fromEdge === "before") {
        index = -1;
      } else if (fromRow && rows.includes(fromRow)) {
        index = rows.indexOf(fromRow);
      } else {
        const activeRow = document.activeElement?.closest?.(".desk-session-row");
        if (activeRow && rows.includes(activeRow)) {
          index = rows.indexOf(activeRow);
        } else if (_deskSelectedSessionName) {
          index = rows.findIndex((row) => row.dataset.sessionName === _deskSelectedSessionName);
        }
      }
      const nextIndex = index < 0 || index >= rows.length
        ? (direction > 0 ? 0 : rows.length - 1)
        : (index + direction + rows.length) % rows.length;
      return openDeskSessionRow(rows[nextIndex]);
    }

    function maybeRestoreDeskSelection() {
      if (_deskSelectedSessionName) {
        if (findSessionRecord(_deskSelectedSessionName)) return;
        clearDeskSelection();
        showDeskSidebarList({ open: true });
        return;
      }
      const requested = getRequestedDeskSelection();
      if (requested) {
        const match = findSessionRecord(requested);
        if (match && !match.archived) {
          openSessionFrame(buildSessionOpenHref(requested, false), requested);
          return;
        }
        persistDeskSelection("");
        setDeskSelectionInUrl("");
        failDeskOpen("Session not found");
        showDeskSidebarList({ open: true });
        return;
      }
      const active = _hubSessionsCache.active || [];
      if (active.length) {
        openSessionFrame(buildSessionOpenHref(active[0].name, false), active[0].name);
        return;
      }
      showDeskSidebarList({ open: true });
      clearDeskChatFrame();
    }
