
    let _deskTimelineSwitcherItems = [];
    let _deskTimelineSwitcherOpen = false;
    async function openDeskNativeTimelineSwitcher() {
      const invoke = getNativeInvoke();
      if (typeof invoke !== "function" || !_deskTimelineList || !_deskAppSidebarToggle) return;
      if (_deskTimelineSwitcherOpen) return;
      const items = [];
      for (const child of Array.from(_deskTimelineList.children)) {
        if (child.classList.contains("desk-section-label")) {
          items.push({ label: child.textContent.trim(), section: true });
        } else if (child.classList.contains("desk-swipe-row")) {
          const row = child.querySelector(".desk-timeline-row");
          const href = row?.dataset.openHref || "";
          if (!row || !href) continue;
          items.push({
            label: (row.querySelector(".desk-row-name")?.textContent || row.dataset.timelineLabel || "").trim(),
            current: row.classList.contains("is-selected"),
            href,
            name: row.dataset.timelineLabel || "",
          });
        }
      }
      if (!items.some((it) => !it.section)) return;
      _deskTimelineSwitcherItems = items;
      const rect = _deskAppSidebarToggle.getBoundingClientRect();
      _deskTimelineSwitcherOpen = true;
      try {
        await invoke("show_timeline_switcher_menu", {
          payload: {
            x: Math.round(rect.right || 0),
            y: Math.round(rect.top || 0),
            items: items.map(({ label, section, current }) => ({ label, section: !!section, current: !!current })),
          },
        });
      } catch (_) {
      } finally {
        _deskTimelineSwitcherOpen = false;
      }
    }

    let _deskGitChangesItems = [];
    let _deskGitChangesOpen = false;
    function requestDeskGitChanges(timeoutMs = 4000) {
      return new Promise((resolve) => {
        const frameWin = _deskRoomFrame?.contentWindow;
        if (!frameWin) { resolve(null); return; }
        let settled = false;
        const done = (value) => {
          if (settled) return;
          settled = true;
          window.removeEventListener("message", onMsg);
          resolve(value);
        };
        const onMsg = (e) => {
          if (e.source !== frameWin || !e.data || e.data.type !== "desk-git-changes") return;
          done(e.data);
        };
        window.addEventListener("message", onMsg);
        setTimeout(() => done(null), timeoutMs);
        frameWin.postMessage({ type: "desk-git-changes-request" }, "*");
      });
    }
    function buildDeskGitChangesItems(files) {
      if (!files.length) return [{ label: "No uncommitted changes", section: true }];
      const norm = files
        .map((f) => ({
          path: String(f.path || "").trim(),
          oldPath: String(f.oldPath || ""),
          ins: Number(f.ins) || 0,
          dels: Number(f.dels) || 0,
          untracked: !!f.untracked,
        }))
        .filter((f) => f.path)
        .sort((a, b) => a.path.localeCompare(b.path));
      const ins = norm.reduce((n, f) => n + f.ins, 0);
      const dels = norm.reduce((n, f) => n + f.dels, 0);
      const items = [{ label: `${norm.length} file${norm.length === 1 ? "" : "s"}  +${ins} -${dels}`, section: true }];
      const base = (p) => { const s = p.lastIndexOf("/"); return s >= 0 ? p.slice(s + 1) : p; };
      const push = (f, withStat) => {
        const stat = withStat && (f.ins || f.dels) ? `  +${f.ins} -${f.dels}` : "";
        items.push({ label: `${base(f.path)}${stat}`, path: f.path, oldPath: f.oldPath, untracked: f.untracked });
      };
      for (const f of norm.filter((f) => !f.untracked)) push(f, true);
      const untracked = norm.filter((f) => f.untracked);
      if (untracked.length) {
        items.push({ label: "Untracked", section: true });
        for (const f of untracked) push(f, false);
      }
      return items;
    }
    async function openDeskNativeGitChanges() {
      const invoke = getNativeInvoke();
      if (typeof invoke !== "function" || !_deskPanelToggle || _deskGitChangesOpen) return;
      _deskGitChangesOpen = true;
      try {
        const data = await requestDeskGitChanges();
        const files = Array.isArray(data?.files) ? data.files : [];
        const items = data?.error
          ? [{ label: "Git unavailable", section: true }]
          : buildDeskGitChangesItems(files);
        _deskGitChangesItems = items;
        const rect = _deskPanelToggle.getBoundingClientRect();
        await invoke("show_git_changes_menu", {
          payload: {
            x: Math.round(rect.right || 0),
            y: Math.round(rect.bottom || 0),
            items: items.map(({ label, section }) => ({ label, section: !!section })),
          },
        });
      } catch (_) {
      } finally {
        _deskGitChangesOpen = false;
      }
    }

    window.addEventListener("native-menu-action", (event) => {
      const detail = event.detail || {};
      if (detail.action === "switchTimeline") {
        const item = _deskTimelineSwitcherItems[Number(detail.mode)];
        if (item && item.href) openTimelineFrame(item.href, item.name);
        return;
      }
      if (detail.action === "gitChange") {
        const item = _deskGitChangesItems[Number(detail.mode)];
        if (item && item.path) {
          _deskRoomFrame?.contentWindow?.postMessage(
            { type: "desk-open-git-file", path: item.path, oldPath: item.oldPath, untracked: !!item.untracked }, "*",
          );
        }
        return;
      }
      if (detail.action === "renameTimeline") {
        if (_deskContextTimelineLabel) beginDeskTimelineRename(_deskContextTimelineLabel);
        return;
      }
      if (detail.action === "copyWorkspacePath") {
        if (_deskContextTimelineLabel) void copyDeskTimelineWorkspace(_deskContextTimelineLabel);
        return;
      }
      if (detail.action === "changeWorkspace") {
        if (_deskContextTimelineLabel) void changeDeskTimelineWorkspace(_deskContextTimelineLabel);
        return;
      }
      if (detail.action === "resetAgents") {
        if (_deskContextTimelineLabel) void resetDeskTimelineAgents(_deskContextTimelineLabel);
        return;
      }
      if (detail.action === "archiveTimeline") {
        if (_deskContextTimelineLabel) void runDeskContextAction(_deskContextTimelineLabel, "kill");
        return;
      }
      if (detail.action === "deleteTimeline") {
        if (_deskContextTimelineLabel) void runDeskContextAction(_deskContextTimelineLabel, "delete-archived");
        return;
      }
      if (detail.action === "reviveTimeline") {
        if (_deskContextTimelineLabel) {
          openTimelineFrame(
            `/revive-room?timeline=${encodeURIComponent(_deskContextTimelineLabel)}`,
            _deskContextTimelineLabel,
          );
        }
        return;
      }
      if (detail.action === "textSize") {
        const mode = String(detail.mode || "");
        if (mode === "increase") {
          applyDeskTextSizeAndBroadcast(currentDeskTextSizePx() + 1);
        } else if (mode === "decrease") {
          applyDeskTextSizeAndBroadcast(currentDeskTextSizePx() - 1);
        } else if (mode === "actual") {
          applyDeskTextSizeAndBroadcast(DESK_TEXT_SIZE_DEFAULT);
        }
        return;
      }
      if (detail.action === "resetWindow") {
        void resetDeskWindowState();
        return;
      }
      if (detail.action === "compactWindow") {
        void compactDeskWindowState();
        return;
      }
      if (detail.action === "miniWindow") {
        void compactDeskWindowState("mini_window_geometry", "mini window");
        return;
      }
      if (detail.action === "moveWindowTop") {
        void moveDeskWindowToSpot("move_window_top");
        return;
      }
      if (detail.action === "moveWindowTopLeft") {
        void moveDeskWindowToSpot("move_window_top_left");
        return;
      }
      if (detail.action === "moveWindowTopRight") {
        void moveDeskWindowToSpot("move_window_top_right");
        return;
      }
      if (detail.action === "moveWindowCenter") {
        void moveDeskWindowToSpot("move_window_center");
        return;
      }
      if (detail.action === "openHubInBrowser") {
        openDeskHubInBrowser();
        return;
      }
      if (detail.action === "toggleHubSidebar") {
        toggleDeskSidebar();
        return;
      }
      if (detail.action === "toggleRightPane") {
        toggleDeskRightPanel();
        return;
      }
      if (detail.action === "toggleHubSidebarOutward") {
        toggleDeskSidebarOutward();
        return;
      }
      if (detail.action === "toggleRightPaneOutward") {
        toggleDeskRightPanelOutward();
        return;
      }
      if (detail.action === "toggleAlwaysOnTop") {
        toggleDeskAlwaysOnTop();
        return;
      }
      if (detail.action === "toggleAutoWindowHeight") {
        void toggleDeskAutoWindowHeight();
        return;
      }
      if (detail.action === "toggleFitCollapsed") {
        toggleDeskFitCollapsed();
        return;
      }
      if (detail.action === "theme") {
        const theme = String(detail.theme || "").trim().toLowerCase();
        if (theme !== "system" && theme !== "light" && theme !== "dark") return;
        applyIncomingThemeDesktop(theme);
        localStorage.setItem(DESK_THEME_KEY, theme);
        return;
      }
      dispatchDeskNativeMenuAction(detail);
    });
