
    // Session-row action icons. Module-scope constants, not rebuilt per row,
    // and shared with applyDeskSessionSelection()'s in-place archived-row swap.
    const DESK_TRASH_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
    const DESK_KILL_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>`;
    const DESK_REVIVE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`;

    function renderDeskSessionRow(session, archived) {
      const sessionName = String(session.name);
      const archivedClass = archived ? " archived" : "";
      const selectedClass = _deskSelectedSessionName === sessionName ? " is-selected" : "";
      const isSelected = _deskSelectedSessionName === sessionName;
      const unreadClass = !isSelected && _deskUnreadSessions.has(sessionName) ? " is-unread" : "";
      const showDelete = archived && isSelected;
      const swipeActionLabel = showDelete ? "Delete" : (archived ? "Revive" : "Archive");
      const swipeActionRoute = showDelete ? "delete-archived" : (archived ? "revive" : "kill");
      const actionSvg = showDelete ? DESK_TRASH_SVG : (archived ? DESK_REVIVE_SVG : DESK_KILL_SVG);
      const previewText = String(session.latest_message_preview || "").trim();
      const previewSender = String(session.latest_message_sender || "").trim();
      const previewDisplay = previewSender ? `${previewSender} ${previewText}` : previewText;
      const previewHtml = previewText
        ? `<div class="desk-row-preview">${esc(previewDisplay)}</div>`
        : "";
      return `<div class="desk-swipe-row" data-session-name="${esc(sessionName)}" data-desk-swipe-kind="${esc(swipeActionRoute)}">` +
        `<div class="desk-swipe-action-rail">` +
          `<button type="button" class="desk-swipe-action-btn" data-desk-swipe-action="${esc(swipeActionRoute)}" aria-label="${esc(swipeActionLabel + " " + sessionName)}">` +
            actionSvg +
            `<span>${esc(swipeActionLabel)}</span>` +
          `</button>` +
        `</div>` +
        `<div class="desk-swipe-track">` +
          `<div class="desk-session-row desk-action-session-row${archivedClass}${selectedClass}${unreadClass}" data-session-name="${esc(sessionName)}" data-open-href="${buildSessionOpenHref(sessionName, archived)}" tabindex="0" role="button" aria-current="${selectedClass ? "page" : "false"}">` +
            `<div class="desk-row-head">` +
                `<div class="desk-row-main">` +
                  `<span class="desk-row-bullet" aria-hidden="true"><i></i></span>` +
                  `<div class="desk-row-stack">` +
                    `<div class="desk-row-name">${esc(sessionName)}</div>` +
                    previewHtml +
                  `</div>` +
                `</div>` +
                `<button type="button" class="desk-row-hover-action" data-desk-hover-action="${esc(swipeActionRoute)}" aria-label="${esc(swipeActionLabel + " " + sessionName)}" title="${esc(swipeActionLabel)}">` +
                  actionSvg +
                `</button>` +
              `</div>` +
            `</div>` +
          `</div>` +
        `</div>`;
    }

    // Selecting a session only changes which row is selected (and, for an
    // archived row, whether its action reads Revive or Delete). Rebuilding the
    // whole list's innerHTML for that recreates every row -- the action icons
    // visibly blink. Patch the affected rows in place instead; the delegated
    // click handlers read data- attributes at event time, and initDeskSwipeRow
    // is a no-op on an already-bound wrapper, so nothing needs re-wiring.
    function applyDeskSessionSelection() {
      if (!_deskSessionList) return;
      for (const wrap of _deskSessionList.querySelectorAll(".desk-swipe-row")) {
        const row = wrap.querySelector(".desk-session-row");
        if (!row) continue;
        const name = row.dataset.sessionName || "";
        const isSelected = name === _deskSelectedSessionName;
        row.classList.toggle("is-selected", isSelected);
        row.classList.toggle("is-unread", !isSelected && _deskUnreadSessions.has(name));
        row.setAttribute("aria-current", isSelected ? "page" : "false");
        if (!row.classList.contains("archived")) continue;
        const kind = isSelected ? "delete-archived" : "revive";
        if (wrap.dataset.deskSwipeKind === kind) continue;
        wrap.dataset.deskSwipeKind = kind;
        const label = isSelected ? "Delete" : "Revive";
        const svg = isSelected ? DESK_TRASH_SVG : DESK_REVIVE_SVG;
        const swipeBtn = wrap.querySelector(".desk-swipe-action-btn");
        if (swipeBtn) {
          swipeBtn.dataset.deskSwipeAction = kind;
          swipeBtn.setAttribute("aria-label", `${label} ${name}`);
          swipeBtn.innerHTML = svg + `<span>${label}</span>`;
        }
        const hoverBtn = wrap.querySelector(".desk-row-hover-action");
        if (hoverBtn) {
          hoverBtn.dataset.deskHoverAction = kind;
          hoverBtn.setAttribute("aria-label", `${label} ${name}`);
          hoverBtn.setAttribute("title", label);
          hoverBtn.innerHTML = svg;
        }
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

    async function runDeskContextAction(sessionName, kind) {
      if (!sessionName || !kind) return;
      showDeskHubMessage();
      const isDelete = kind === "delete-archived";
      const confirmed = isTauriDesktopApp()
        ? true
        : (isDelete
          ? confirm("Delete archived logs for " + sessionName + "? This cannot be undone.")
          : confirm("Archive " + sessionName + "?"));
      if (!confirmed) return;
      const route = isDelete ? "/delete-archived-session" : "/kill-session";
      const isSelected = _deskSelectedSessionName === sessionName;
      try {
        const response = await fetch(
          `${route}?session=${encodeURIComponent(sessionName)}&format=json&ts=${Date.now()}`,
          { cache: "no-store" }
        );
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.error || (isDelete ? "Failed to delete session." : "Failed to archive session."));
        }
        const activeHref = buildSessionOpenHref(sessionName, false);
        const archivedHref = buildSessionOpenHref(sessionName, true);
        hubChatUrls.forget(activeHref);
        hubChatUrls.forget(archivedHref);
        if (isSelected) {
          _deskOpenToken += 1;
          _deskSelectedSessionName = "";
          updateDeskWindowTitle("");
          persistDeskSelection("");
          setDeskSelectionInUrl("");
        }
        await refreshHubSessions(true, { skipRestore: true });
        if (!isSelected) return;
        clearDeskSelection();
        showDeskSidebarList({ open: true });
      } catch (err) {
        showDeskHubMessage(
          err?.message || (isDelete ? "Failed to delete session." : "Failed to archive session."),
          { error: true },
        );
      }
    }

    async function renameDeskSession(oldName, requestedName) {
      const newName = String(requestedName || "").trim();
      if (!oldName) return false;
      if (oldName === newName) return true;
      showDeskHubMessage();
      try {
        const response = await fetch("/rename-session", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({ old_name: oldName, new_name: newName }).toString(),
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Failed to rename session.");
        }
        const renamed = String(data.new_name || newName);
        hubChatUrls.forget(buildSessionOpenHref(oldName, false));
        hubChatUrls.forget(buildSessionOpenHref(oldName, true));
        if (_deskUnreadSessions.delete(oldName)) _deskUnreadSessions.add(renamed);
        if (_deskSelectedSessionName === oldName) {
          _deskSelectedSessionName = renamed;
          updateDeskWindowTitle(renamed);
          persistDeskSelection(renamed);
          setDeskSelectionInUrl(renamed);
        }
        return true;
      } catch (err) {
        showDeskHubMessage(err?.message || "Failed to rename session.", { error: true });
        return false;
      }
    }

    async function changeDeskSessionWorkspace(sessionName) {
      if (!sessionName) return;
      showDeskHubMessage();
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
        showDeskHubMessage(err?.message || "Workspace picker failed.", { error: true });
        return;
      }
      if (picked.canceled || !picked.path) return;
      try {
        const res = await fetch("/change-session-workspace", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({ session: sessionName, workspace: picked.path }).toString(),
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to change workspace.");
      } catch (err) {
        showDeskHubMessage(err?.message || "Failed to change workspace.", { error: true });
        return;
      }
      // A chat URL cached for this archived session was resolved against the
      // old workspace's port; drop it so the next open re-resolves.
      hubChatUrls.forget(buildSessionOpenHref(sessionName, true));
      showDeskHubMessage(`Workspace updated for ${sessionName}.`);
    }

    async function copyDeskSessionWorkspace(sessionName) {
      if (!sessionName) return;
      showDeskHubMessage();
      try {
        const res = await fetch(`/session-workspace?session=${encodeURIComponent(sessionName)}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const workspace = String(data.workspace || "").trim();
        if (!res.ok || !data.ok || !workspace) {
          throw new Error(data.error || "Workspace path is unavailable.");
        }
        await copyDeskText(workspace);
      } catch (err) {
        showDeskHubMessage(err?.message || "Failed to copy workspace path.", { error: true });
        return;
      }
      showDeskHubMessage(`Copied workspace path for ${sessionName}.`);
    }

    async function resetDeskSessionAgents(sessionName) {
      if (!sessionName) return;
      showDeskHubMessage();
      try {
        const res = await fetch("/reset-session-agents", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({ session: sessionName }).toString(),
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to reset agents.");
      } catch (err) {
        showDeskHubMessage(err?.message || "Failed to reset agents.", { error: true });
        return;
      }
      if (_deskSelectedSessionName === sessionName) {
        postDeskChatFrameMessage({ type: "refresh-session-state", projections: ["targets"] });
      }
      await refreshHubSessions(true, { skipRestore: true });
      showDeskHubMessage(`Agents reset for ${sessionName}.`);
    }

    function beginDeskSessionRename(sessionName) {
      if (_deskSessionRename) _deskSessionRename.cancel();
      const row = Array.from(_deskSessionList?.querySelectorAll(".desk-action-session-row") || [])
        .find((candidate) => candidate.dataset.sessionName === sessionName);
      const nameEl = row?.querySelector(".desk-row-name");
      if (!row || !nameEl) return;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "desk-row-rename-input";
      input.value = sessionName;
      input.setAttribute("aria-label", `Rename ${sessionName}`);
      nameEl.replaceWith(input);
      row.classList.add("is-renaming");

      let settling = false;
      const cancel = () => {
        if (_deskSessionRename?.input !== input) return;
        _deskSessionRename = null;
        row.classList.remove("is-renaming");
        if (input.isConnected) input.replaceWith(nameEl);
      };
      const commit = async () => {
        if (_deskSessionRename?.input !== input || settling) return;
        settling = true;
        input.disabled = true;
        const renamed = await renameDeskSession(sessionName, input.value);
        if (renamed) {
          _deskSessionRename = null;
          await refreshHubSessions(true, { skipRestore: true });
          return;
        }
        settling = false;
        input.disabled = false;
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      };
      _deskSessionRename = { input, cancel };
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
      const row = wrapper.querySelector(".desk-session-row");
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
        const sessionName = wrapper.dataset.sessionName || "";
        const kind = actionBtn.dataset.deskSwipeAction || "";
        runDeskContextAction(sessionName, kind);
      });
    }

    function renderDesktopSessions(active, archived) {
      if (!_deskSessionList) return;
      let html = "";
      if (active.length) {
        html += `<div class="desk-section-label">Active</div>`;
        html += active.map((session) => renderDeskSessionRow(session, false)).join("");
      }
      if (archived.length) {
        html += `<div class="desk-section-label">Archived</div>`;
        html += archived.map((session) => renderDeskSessionRow(session, true)).join("");
      }
      if (!active.length && !archived.length) {
        html = `<div class="desk-empty-list">No sessions found</div>`;
      }
      _deskSessionList.innerHTML = html;
      _deskSessionList.querySelectorAll(".desk-swipe-row").forEach(initDeskSwipeRow);
      updateDeskSessionListFade();
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
      _deskFloatingControls.classList.remove("is-port-hidden", "is-title-hidden", "is-buttons-hidden");
      _deskTopRightControls.classList.remove("is-buttons-hidden");
      const trafficLeft = _deskWindowTraffic.getBoundingClientRect().left;
      if (trafficLeft <= 0) return;
      const chromeGroupGap = DESK_CHROME_GROUP_GAP_AT_DEFAULT_TEXT_SIZE
        * currentDeskTextSizePx() / DESK_TEXT_SIZE_DEFAULT;
      const collides = () => _deskFloatingControls.getBoundingClientRect().right + chromeGroupGap > trafficLeft;
      if (!collides()) return;
      // Drop the "(port)" suffix first -- the session name alone often still fits.
      _deskFloatingControls.classList.add("is-port-hidden");
      if (!collides()) return;
      _deskFloatingControls.classList.add("is-title-hidden");
      if (!collides()) return;
      _deskFloatingControls.classList.add("is-buttons-hidden");
      _deskTopRightControls.classList.add("is-buttons-hidden");
    }

    function updateDeskSessionListFade() {
      if (!_deskSessionList) return;
      _deskSessionList.dataset.scrollFade = computeScrollFadeState(_deskSessionList);
    }

    function updateDeskUnreadSessions(active) {
      const nextRevisions = new Map();
      const activeNames = new Set();
      active.forEach((session) => {
        const name = String(session.name || "").trim();
        if (!name) return;
        activeNames.add(name);
        const revision = String(session.latest_message_revision || "").trim();
        const previousRevision = _deskPreviewRevisions.get(name);
        if (
          previousRevision &&
          revision &&
          revision !== previousRevision &&
          name !== _deskSelectedSessionName &&
          String(session.latest_message_sender || "").trim() !== "user"
        ) {
          _deskUnreadSessions.add(name);
        }
        nextRevisions.set(name, revision);
      });
      Array.from(_deskUnreadSessions).forEach((name) => {
        if (!activeNames.has(name)) _deskUnreadSessions.delete(name);
      });
      _deskPreviewRevisions = nextRevisions;
    }

    async function refreshHubSessions(force = false, options = {}) {
      const skipRestore = !!(options && options.skipRestore);
      const requestSeq = ++_deskSessionsRequestSeq;
      try {
        const response = await fetch(`/sessions?ts=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error("failed");
        const data = await response.json();
        const active = data.active_sessions;
        const archived = data.archived_sessions;
        _hubSessionsCache = { active, archived };
        if (requestSeq === _deskSessionsRequestSeq) {
          updateDeskUnreadSessions(active);
          if (_deskSelectedSessionName) updateDeskWindowTitle(_deskSelectedSessionName);

          const signature = JSON.stringify({
            active,
            archived,
            selected: _deskSelectedSessionName,
          });
          if (!_deskSessionRename && (force || window._lastHubRenderSig !== signature)) {
            window._lastHubRenderSig = signature;
            renderDesktopSessions(active, archived);
          }
          _deskSessionsRenderedOnce = true;
        }
        if (!skipRestore) maybeRestoreDeskSelection();
      } catch (_) {
        if (requestSeq !== _deskSessionsRequestSeq) return;
        if (_deskSessionsRenderedOnce || _hubSessionsCache.active.length || _hubSessionsCache.archived.length) return;
        if (_deskSessionList) {
          _deskSessionList.innerHTML = `<div class="desk-empty-list">Failed to load sessions</div>`;
        }
      }
    }
