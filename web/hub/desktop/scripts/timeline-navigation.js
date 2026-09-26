
    async function pickWorkspaceForNewTimeline() {
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

    async function startDeskNewTimelineFlow() {
      if (_deskNewTimelineStarting) return;
      _deskNewTimelineStarting = true;
      _deskNewTimelineToggle?.classList.add("archived");
      setStatus("");
      try {
        const workspace = await pickWorkspaceForNewTimeline();
        if (!workspace) return;
        const res = await fetch("/start-timeline-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok || !data.room_url) {
          throw new Error(data.error || "Failed to open draft timeline.");
        }
        openRoomInDesk(data.room_url, data.timeline || "");
        setStatus(data.notice || "");
        if (isPhoneViewport()) {
          setDeskSidebarOpen(false);
        }
        void refreshHubTimelines(true, { skipRestore: true });
      } catch (err) {
        setStatus(err?.message || "Failed to open draft timeline.");
      } finally {
        _deskNewTimelineStarting = false;
        _deskNewTimelineToggle?.classList.remove("archived");
      }
    }

    function navigateDeskRoomFrame(url) {
      const target = String(url || "") || "about:blank";
      _deskRoomFrameLoadedUrl = target === "about:blank" ? "" : target;
      const win = _deskRoomFrame && _deskRoomFrame.contentWindow;
      if (win) {
        try {
          win.location.replace(target);
          return;
        } catch (_) {
        }
      }
      if (_deskRoomFrame) _deskRoomFrame.src = target;
    }

    function clearDeskRoomFrame() {
      navigateDeskRoomFrame("about:blank");
      setDeskRoomLoading(false);
    }

    function clearDeskSelection() {
      _deskOpenToken += 1;
      _deskSelectedTimelineLabel = "";
      updateDeskWindowTitle("");
      persistDeskSelection("");
      clearDeskRoomFrame();
      applyDeskTimelineSelection();
    }

    function openRoomInDesk(url, name) {
      if (!_deskRoomFrame) return;
      _deskSelectedTimelineLabel = name || "";
      _deskUnreadTimelines.delete(_deskSelectedTimelineLabel);
      updateDeskWindowTitle(_deskSelectedTimelineLabel);
      persistDeskSelection(_deskSelectedTimelineLabel);
      if (isDeskTimelineSidebarOpen()) _deskRoomFrame.dataset.hubSidebarOpen = "1";
      else delete _deskRoomFrame.dataset.hubSidebarOpen;
      if (_deskSelectedTimelineLabel) {
        cacheDeskRoomUrl(buildTimelineOpenHref(_deskSelectedTimelineLabel, false), url);
      }
      const frameUrl = buildDeskRoomFrameUrl(url);
      if (frameUrl) {
        const currentUrl = normalizeComparableUrl(_deskRoomFrameLoadedUrl);
        const nextUrl = normalizeComparableUrl(frameUrl);
        if (!currentUrl || currentUrl !== nextUrl) {
          setDeskRoomLoading(true);
          navigateDeskRoomFrame(frameUrl);
        } else {
          setDeskRoomLoading(false);
        }
      } else {
        setDeskRoomLoading(false);
      }
      applyDeskTimelineSelection();
    }

    function resolveTimelineRoomUrl(openHref, { force = false } = {}) {
      return hubRoomUrls.resolve(openHref, "", { force });
    }

    async function openTimelineFrame(openHref, name) {
      if (!name) {
        failDeskOpen("Timeline not found");
        return;
      }
      const needsReviveTransition = /^\/revive-room(?:[/?]|$)/.test(String(openHref || ""));
      if (!needsReviveTransition && name === _deskSelectedTimelineLabel && _deskRoomFrameLoadedUrl) return;
      const archived = !!findTimelineRecord(name)?.archived;
      const closeOnOpen = isPhoneViewport();
      _deskSelectedTimelineLabel = name;
      updateDeskWindowTitle(name);
      persistDeskSelection(name);
      applyDeskTimelineSelection();
      setDeskRoomLoading(true);
      const openToken = ++_deskOpenToken;
      try {
        const roomUrl = await resolveTimelineRoomUrl(openHref, { force: archived || needsReviveTransition });
        if (openToken !== _deskOpenToken) return;
        if (needsReviveTransition) {
          await refreshHubTimelines(true, { skipRestore: true });
          if (openToken !== _deskOpenToken) return;
        }
        openRoomInDesk(roomUrl, name);
        if (closeOnOpen) setDeskSidebarOpen(false);
      } catch (err) {
        if (openToken !== _deskOpenToken) return;
        failDeskOpen(err?.message || "open timeline failed");
      }
    }

    function getDeskTimelineRows() {
      if (!_deskTimelineList) return [];
      return Array.from(_deskTimelineList.querySelectorAll(".desk-timeline-row[data-open-href][data-timeline-label]"))
        .filter((row) => row && row.getClientRects().length > 0);
    }

    function focusDeskTimelineRow(row) {
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

    function focusDeskTimelineByName(name) {
      if (!_deskTimelineList || !name) return;
      const row = _deskTimelineList.querySelector(`.desk-timeline-row[data-timeline-label="${cssEsc(name)}"]`);
      focusDeskTimelineRow(row);
    }

    function deskTimelineOpenHref(row) {
      const name = row?.dataset.timelineLabel || "";

      return row?.dataset.openHref || "";
    }

    function openDeskTimelineRow(row) {
      if (!row) return false;
      const href = deskTimelineOpenHref(row);
      const name = row.dataset.timelineLabel || "";
      if (!href || !name) return false;
      openTimelineFrame(href, name);
      requestAnimationFrame(() => focusDeskTimelineByName(name));
      return true;
    }

    function moveDeskTimelineSelection(direction, fromRow = null, fromEdge = "") {
      const rows = getDeskTimelineRows();
      if (!rows.length) return false;
      let index = -1;
      if (fromEdge === "after") {
        index = rows.length;
      } else if (fromEdge === "before") {
        index = -1;
      } else if (fromRow && rows.includes(fromRow)) {
        index = rows.indexOf(fromRow);
      } else {
        const activeRow = document.activeElement?.closest?.(".desk-timeline-row");
        if (activeRow && rows.includes(activeRow)) {
          index = rows.indexOf(activeRow);
        } else if (_deskSelectedTimelineLabel) {
          index = rows.findIndex((row) => row.dataset.timelineLabel === _deskSelectedTimelineLabel);
        }
      }
      const nextIndex = index < 0 || index >= rows.length
        ? (direction > 0 ? 0 : rows.length - 1)
        : (index + direction + rows.length) % rows.length;
      return openDeskTimelineRow(rows[nextIndex]);
    }

    function maybeRestoreDeskSelection() {
      if (_deskSelectedTimelineLabel) {
        if (findTimelineRecord(_deskSelectedTimelineLabel)) return;
        clearDeskSelection();
        showDeskSidebarList({ open: true });
        return;
      }
      const requested = getPersistedDeskSelection();
      if (requested) {
        const match = findTimelineRecord(requested);
        if (match && !match.archived) {
          openTimelineFrame(buildTimelineOpenHref(requested, false), requested);
          return;
        }
        persistDeskSelection("");
        failDeskOpen("Timeline not found");
        showDeskSidebarList({ open: true });
        return;
      }
      const active = _hubTimelinesCache.active || [];
      if (active.length) {
        openTimelineFrame(buildTimelineOpenHref(active[0].name, false), active[0].name);
        return;
      }
      showDeskSidebarList({ open: true });
      clearDeskRoomFrame();
    }
