
    const DESK_KILL_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>`;
    const DESK_REVIVE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`;
    const DESK_TIMELINE_ACTION_TITLE = {
      kill: "Archive — Kill tmux session; keep log",
      revive: "Revive — Restart tmux session with saved agent topology",
      "delete-archived": "Delete — Delete ~/.agent-window/log/{label}",
    };

    function renderDeskTimelineRow(timeline, archived) {
      const timelineLabel = String(timeline.name);
      const archivedClass = archived ? " archived" : "";
      const selectedClass = _deskSelectedTimelineLabel === timelineLabel ? " is-selected" : "";
      const isSelected = _deskSelectedTimelineLabel === timelineLabel;
      const unreadClass = !isSelected && _deskUnreadTimelines.has(timelineLabel) ? " is-unread" : "";
      const swipeActionLabel = archived ? "Revive" : "Archive";
      const swipeActionRoute = archived ? "revive" : "kill";
      const swipeActionTitle = DESK_TIMELINE_ACTION_TITLE[swipeActionRoute];
      const actionSvg = archived ? DESK_REVIVE_SVG : DESK_KILL_SVG;
      const previewText = String(timeline.latest_message_preview || "").trim();
      const previewSender = String(timeline.latest_message_sender || "").trim();
      const previewDisplay = previewSender ? `${previewSender} ${previewText}` : previewText;
      const previewHtml = previewText
        ? `<div class="desk-row-preview">${esc(previewDisplay)}</div>`
        : "";
      return `<div class="desk-swipe-row" data-timeline-label="${esc(timelineLabel)}">` +
        `<div class="desk-swipe-action-rail">` +
          `<button type="button" class="desk-swipe-action-btn" data-desk-swipe-action="${esc(swipeActionRoute)}" aria-label="${esc(swipeActionLabel + " " + timelineLabel)}" title="${esc(swipeActionTitle)}">` +
            actionSvg +
            `<span>${esc(swipeActionLabel)}</span>` +
          `</button>` +
        `</div>` +
        `<div class="desk-swipe-track">` +
          `<div class="desk-timeline-row desk-action-timeline-row${archivedClass}${selectedClass}${unreadClass}" data-timeline-label="${esc(timelineLabel)}" data-open-href="${buildTimelineOpenHref(timelineLabel, archived)}" tabindex="0" role="button" aria-current="${selectedClass ? "page" : "false"}">` +
            `<div class="desk-row-head">` +
                `<div class="desk-row-main">` +
                  `<span class="desk-row-bullet" aria-hidden="true"><i></i></span>` +
                  `<div class="desk-row-stack">` +
                    `<div class="desk-row-name">${esc(timelineLabel)}</div>` +
                    previewHtml +
                  `</div>` +
                `</div>` +
                `<button type="button" class="desk-row-hover-action" data-desk-hover-action="${esc(swipeActionRoute)}" aria-label="${esc(swipeActionLabel + " " + timelineLabel)}" title="${esc(swipeActionTitle)}">` +
                  actionSvg +
                `</button>` +
              `</div>` +
            `</div>` +
          `</div>` +
        `</div>`;
    }

    function applyDeskTimelineSelection() {
      if (!_deskTimelineList) return;
      for (const wrap of _deskTimelineList.querySelectorAll(".desk-swipe-row")) {
        const row = wrap.querySelector(".desk-timeline-row");
        if (!row) continue;
        const name = row.dataset.timelineLabel || "";
        const isSelected = name === _deskSelectedTimelineLabel;
        row.classList.toggle("is-selected", isSelected);
        row.classList.toggle("is-unread", !isSelected && _deskUnreadTimelines.has(name));
        row.setAttribute("aria-current", isSelected ? "page" : "false");
      }
    }

    function closeDeskSwipeRow(wrapper, animate = true) {
      if (!wrapper) return;
      const track = wrapper.querySelector(".desk-swipe-track");
      if (!track) return;
      track.style.transition = animate ? "transform 220ms cubic-bezier(.25,.46,.45,.94)" : "none";
      track.style.transform = "";
      wrapper.dataset.swipeOpen = "0";
      if (_deskOpenSwipeRow === wrapper) _deskOpenSwipeRow = null;
    }

    async function runDeskContextAction(timelineLabel, kind) {
      if (!timelineLabel || !kind) return;
      setStatus("");
      const isDelete = kind === "delete-archived";
      const confirmed = isNativeApp()
        ? true
        : (isDelete
          ? confirm("Delete archived logs for " + timelineLabel + "? This cannot be undone.")
          : confirm("Archive " + timelineLabel + "?"));
      if (!confirmed) return;
      const route = isDelete ? "/delete-archived-timeline" : "/archive-room";
      const isSelected = _deskSelectedTimelineLabel === timelineLabel;
      try {
        const response = await fetch(
          `${route}?timeline=${encodeURIComponent(timelineLabel)}&format=json&ts=${Date.now()}`,
          { cache: "no-store" }
        );
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.error || (isDelete ? "Failed to delete timeline." : "Failed to archive timeline."));
        }
        const activeHref = buildTimelineOpenHref(timelineLabel, false);
        const archivedHref = buildTimelineOpenHref(timelineLabel, true);
        hubRoomUrls.forget(activeHref);
        hubRoomUrls.forget(archivedHref);
        if (isSelected) {
          _deskOpenToken += 1;
          _deskSelectedTimelineLabel = "";
          updateDeskWindowTitle("");
          persistDeskSelection("");
        }
        await refreshHubTimelines(true, { skipRestore: true });
        if (!isSelected) return;
        clearDeskSelection();
        showDeskSidebarList({ open: true });
      } catch (err) {
        setStatus(err?.message || (isDelete ? "Failed to delete timeline." : "Failed to archive timeline."));
      }
    }

    async function renameDeskTimeline(oldName, requestedName) {
      const newName = String(requestedName || "").trim();
      if (!oldName) return false;
      if (oldName === newName) return true;
      setStatus("");
      try {
        const response = await fetch("/rename-timeline", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({ old_name: oldName, new_name: newName }).toString(),
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Failed to rename timeline.");
        }
        const renamed = String(data.new_name || newName);
        hubRoomUrls.forget(buildTimelineOpenHref(oldName, false));
        hubRoomUrls.forget(buildTimelineOpenHref(oldName, true));
        if (_deskUnreadTimelines.delete(oldName)) _deskUnreadTimelines.add(renamed);
        if (_deskSelectedTimelineLabel === oldName) {
          _deskSelectedTimelineLabel = renamed;
          updateDeskWindowTitle(renamed);
          persistDeskSelection(renamed);
        }
        return true;
      } catch (err) {
        setStatus(err?.message || "Failed to rename timeline.");
        return false;
      }
    }

    async function changeDeskTimelineWorkspace(timelineLabel) {
      if (!timelineLabel) return;
      setStatus("");
      let picked;
      try {
        const res = await fetch("/pick-workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          cache: "no-store",
        });
        picked = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(picked.error || "Workspace picker failed.");
      } catch (err) {
        setStatus(err?.message || "Workspace picker failed.");
        return;
      }
      if (picked.canceled || !picked.path) return;
      try {
        const res = await fetch("/change-timeline-workspace", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({ timeline: timelineLabel, workspace: picked.path }).toString(),
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to change workspace.");
      } catch (err) {
        setStatus(err?.message || "Failed to change workspace.");
        return;
      }
      hubRoomUrls.forget(buildTimelineOpenHref(timelineLabel, true));
      setStatus("Workspace updated");
    }

    async function copyDeskTimelineWorkspace(timelineLabel) {
      if (!timelineLabel) return;
      setStatus("");
      try {
        const res = await fetch(`/timeline-workspace?timeline=${encodeURIComponent(timelineLabel)}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const workspace = String(data.workspace || "").trim();
        if (!res.ok || !data.ok || !workspace) {
          throw new Error(data.error || "Workspace path is unavailable.");
        }
        await copyDeskText(workspace);
      } catch (err) {
        setStatus(err?.message || "Failed to copy workspace path.");
        return;
      }
      setStatus("Copied path");
    }

    async function resetDeskTimelineAgents(timelineLabel) {
      if (!timelineLabel) return;
      setStatus("");
      try {
        const res = await fetch("/reset-timeline-agents", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({ timeline: timelineLabel }).toString(),
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to reset agents.");
      } catch (err) {
        setStatus(err?.message || "Failed to reset agents.");
        return;
      }
      if (_deskSelectedTimelineLabel === timelineLabel) {
        postDeskRoomFrameMessage({ type: "refresh-room-state" });
      }
      await refreshHubTimelines(true, { skipRestore: true });
      setStatus("Agents reset");
    }

    function beginDeskTimelineRename(timelineLabel) {
      if (_deskTimelineRename) _deskTimelineRename.cancel();
      const row = Array.from(_deskTimelineList?.querySelectorAll(".desk-action-timeline-row") || [])
        .find((candidate) => candidate.dataset.timelineLabel === timelineLabel);
      const nameEl = row?.querySelector(".desk-row-name");
      if (!row || !nameEl) return;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "desk-row-rename-input";
      input.value = timelineLabel;
      input.setAttribute("aria-label", `Rename ${timelineLabel}`);
      nameEl.replaceWith(input);
      row.classList.add("is-renaming");

      let settling = false;
      const cancel = () => {
        if (_deskTimelineRename?.input !== input) return;
        _deskTimelineRename = null;
        row.classList.remove("is-renaming");
        if (input.isConnected) input.replaceWith(nameEl);
      };
      const commit = async () => {
        if (_deskTimelineRename?.input !== input || settling) return;
        settling = true;
        input.disabled = true;
        const renamed = await renameDeskTimeline(timelineLabel, input.value);
        if (renamed) {
          _deskTimelineRename = null;
          await refreshHubTimelines(true, { skipRestore: true });
          return;
        }
        settling = false;
        input.disabled = false;
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      };
      _deskTimelineRename = { input, cancel };
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      });
      input.addEventListener("blur", () => { void commit(); });
      input.addEventListener("click", (event) => event.stopPropagation());
      input.addEventListener("contextmenu", (event) => event.stopPropagation());
      input.focus();
      input.select();
    }

    function initDeskSwipeRow(wrapper) {
      if (!wrapper || wrapper.dataset.swipeBound === "1") return;
      const track = wrapper.querySelector(".desk-swipe-track");
      const row = wrapper.querySelector(".desk-timeline-row");
      const actionBtn = wrapper.querySelector("[data-desk-swipe-action]");
      if (!track || !row || !actionBtn) return;
      wrapper.dataset.swipeBound = "1";
      wrapper.dataset.swipeOpen = "0";
      let startX = 0;
      let startY = 0;
      let deltaX = 0;
      let axis = "";
      let active = false;
      let didSwipe = false;
      let baseX = 0;
      const setTrackX = (x, animate = false) => {
        track.style.transition = animate ? "transform 220ms cubic-bezier(.25,.46,.45,.94)" : "none";
        track.style.transform = x ? `translateX(${x}px)` : "";
        wrapper.dataset.swipeOpen = x ? "1" : "0";
        if (!x && _deskOpenSwipeRow === wrapper) _deskOpenSwipeRow = null;
        if (x) _deskOpenSwipeRow = wrapper;
      };
      const startDrag = (clientX, clientY) => {
        if (_deskOpenSwipeRow && _deskOpenSwipeRow !== wrapper) {
          closeDeskSwipeRow(_deskOpenSwipeRow, true);
        }
        startX = clientX;
        startY = clientY;
        deltaX = 0;
        axis = "";
        active = true;
        didSwipe = false;
        baseX = wrapper.dataset.swipeOpen === "1" ? -DESK_SWIPE_ACTION_WIDTH : 0;
        track.style.transition = "none";
      };
      const moveDrag = (clientX, clientY, preventDefault) => {
        if (!active) return;
        const moveX = clientX - startX;
        const moveY = clientY - startY;
        if (!axis) {
          if (Math.abs(moveY) > Math.abs(moveX) + 4) {
            axis = "y";
            return;
          }
          if (Math.abs(moveX) > 6) axis = "x";
        }
        if (axis !== "x") return;
        if (preventDefault) preventDefault();
        didSwipe = true;
        deltaX = moveX;
        let nextX = Math.max(-DESK_SWIPE_ACTION_WIDTH, Math.min(0, baseX + moveX));
        track.style.transform = nextX ? `translateX(${nextX}px)` : "";
      };
      const endDrag = () => {
        if (!active) return;
        active = false;
        if (axis !== "x") return;
        const finalX = Math.max(-DESK_SWIPE_ACTION_WIDTH, Math.min(0, baseX + deltaX));
        if (finalX < -DESK_SWIPE_OPEN_THRESHOLD) {
          setTrackX(-DESK_SWIPE_ACTION_WIDTH, true);
        } else {
          setTrackX(0, true);
        }
        if (didSwipe) {
          wrapper._swipeConsumedUntil = Date.now() + 260;
        }
        deltaX = 0;
      };
      track.addEventListener("touchstart", (event) => {
        if (event.target.closest("[data-desk-action]")) return;
        const touch = event.touches[0];
        if (!touch) return;
        startDrag(touch.clientX, touch.clientY);
      }, { passive: true });
      track.addEventListener("touchmove", (event) => {
        const touch = event.touches[0];
        if (!touch) return;
        moveDrag(touch.clientX, touch.clientY, () => event.preventDefault());
      }, { passive: false });
      track.addEventListener("touchend", endDrag, { passive: true });
      track.addEventListener("touchcancel", endDrag, { passive: true });
      track.addEventListener("mousedown", (event) => {
        if (!isPhoneViewport()) return;
        if (event.target.closest("[data-desk-action], a, button")) return;
        event.preventDefault();
        startDrag(event.clientX, event.clientY);
        const onMove = (moveEvent) => moveDrag(moveEvent.clientX, moveEvent.clientY, () => moveEvent.preventDefault());
        const onUp = () => {
          endDrag();
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
      actionBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const timelineLabel = wrapper.dataset.timelineLabel || "";
        const kind = actionBtn.dataset.deskSwipeAction || "";
        runDeskContextAction(timelineLabel, kind);
      });
    }

    function renderDesktopTimelines(active, archived) {
      if (!_deskTimelineList) return;
      const rowKey = (wrap) => wrap.dataset.timelineLabel || "";
      const firstRects = captureListRowRects(_deskTimelineList, ".desk-swipe-row", rowKey);
      const newTimelineSection = _deskNewTimelineToggle?.closest(".desk-new-timeline-section") || null;
      let html = "";
      if (active.length) {
        html += `<div class="desk-section-label">Active</div>`;
        html += active.map((timeline) => renderDeskTimelineRow(timeline, false)).join("");
      }
      if (archived.length) {
        html += `<div class="desk-section-label">Archived</div>`;
        html += archived.map((timeline) => renderDeskTimelineRow(timeline, true)).join("");
      }
      if (!active.length && !archived.length) {
        html = `<div class="desk-empty-list">No timelines found</div>`;
      }
      _deskTimelineList.innerHTML = html;
      if (newTimelineSection) _deskTimelineList.prepend(newTimelineSection);
      _deskTimelineList.querySelectorAll(".desk-swipe-row").forEach(initDeskSwipeRow);
      updateDeskTimelineListFade();
      flipListRows(_deskTimelineList, ".desk-swipe-row", rowKey, firstRects);
    }

    function computeScrollFadeState(el) {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const overflowing = scrollHeight > clientHeight + 1;
      if (!overflowing) return "none";
      const atTop = scrollTop <= 1;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
      if (atTop && !atBottom) return "bottom";
      if (atBottom && !atTop) return "top";
      return "both";
    }

    const DESK_CHROME_GROUP_GAP_AT_DEFAULT_TEXT_SIZE = 16;
    function updateDeskChromeOverflow() {
      if (!_deskFloatingControls || !_deskTopRightControls || !_deskWindowTraffic) return;
      _deskFloatingControls.classList.remove("is-title-hidden", "is-buttons-hidden");
      _deskTopRightControls.classList.remove("is-buttons-hidden");
      const trafficLeft = _deskWindowTraffic.getBoundingClientRect().left;
      if (trafficLeft <= 0) return;
      const chromeGroupGap = DESK_CHROME_GROUP_GAP_AT_DEFAULT_TEXT_SIZE
        * currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT;
      const collides = () => _deskFloatingControls.getBoundingClientRect().right + chromeGroupGap > trafficLeft;
      if (!collides()) return;
      _deskFloatingControls.classList.add("is-title-hidden");
      if (!collides()) return;
      _deskFloatingControls.classList.add("is-buttons-hidden");
      _deskTopRightControls.classList.add("is-buttons-hidden");
    }

    function updateDeskTimelineListFade() {
      if (!_deskTimelineList) return;
      _deskTimelineList.dataset.scrollFade = computeScrollFadeState(_deskTimelineList);
    }

    function updateDeskUnreadTimelines(active) {
      const nextRevisions = new Map();
      const activeNames = new Set();
      active.forEach((timeline) => {
        const name = String(timeline.name || "").trim();
        if (!name) return;
        activeNames.add(name);
        const revision = String(timeline.latest_message_revision || "").trim();
        const previousRevision = _deskPreviewRevisions.get(name);
        if (
          previousRevision &&
          revision &&
          revision !== previousRevision &&
          name !== _deskSelectedTimelineLabel &&
          String(timeline.latest_message_sender || "").trim() !== "user"
        ) {
          _deskUnreadTimelines.add(name);
        }
        nextRevisions.set(name, revision);
      });
      Array.from(_deskUnreadTimelines).forEach((name) => {
        if (!activeNames.has(name)) _deskUnreadTimelines.delete(name);
      });
      _deskPreviewRevisions = nextRevisions;
    }

    async function refreshHubTimelines(force = false, options = {}) {
      const skipRestore = !!(options && options.skipRestore);
      const requestSeq = ++_deskTimelinesRequestSeq;
      try {
        const response = await fetch(`/timelines?ts=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error("failed");
        const data = await response.json();
        if (data.hub_instance !== HUB_INSTANCE) {
          setResidentStatus("hub-restarted", "Hub restarted; reload");
        }
        const active = data.active_timelines;
        const archived = data.archived_timelines;
        _hubTimelinesCache = { active, archived };
        if (requestSeq === _deskTimelinesRequestSeq) {
          updateDeskUnreadTimelines(active);
          if (_deskSelectedTimelineLabel) updateDeskWindowTitle(_deskSelectedTimelineLabel);

          const signature = JSON.stringify({
            active,
            archived,
            selected: _deskSelectedTimelineLabel,
          });
          if (!_deskTimelineRename && (force || window._lastHubRenderSig !== signature)) {
            window._lastHubRenderSig = signature;
            renderDesktopTimelines(active, archived);
          }
          _deskTimelinesRenderedOnce = true;
        }
        if (!skipRestore) maybeRestoreDeskSelection();
      } catch (_) {
        if (requestSeq !== _deskTimelinesRequestSeq) return;
        if (_deskTimelinesRenderedOnce || _hubTimelinesCache.active.length || _hubTimelinesCache.archived.length) return;
        if (_deskTimelineList) {
          const newTimelineSection = _deskNewTimelineToggle?.closest(".desk-new-timeline-section") || null;
          _deskTimelineList.innerHTML = `<div class="desk-empty-list">Failed to load timelines</div>`;
          if (newTimelineSection) _deskTimelineList.prepend(newTimelineSection);
        }
      }
    }
