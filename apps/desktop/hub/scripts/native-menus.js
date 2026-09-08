
    // Fit Height to Message shrinks the window past what the DOM session
    // popover needs, and a DOM popover can't cross the window edge. In that
    // mode the collapsed sidebar opens a native menu (which can) instead.
    let _deskSessionSwitcherItems = [];
    let _deskSessionSwitcherOpen = false;
    async function openDeskNativeSessionSwitcher() {
      const invoke = getTauriInvoke();
      if (typeof invoke !== "function" || !_deskSessionList || !_deskAppSidebarToggle) return;
      if (_deskSessionSwitcherOpen) return;
      const items = [];
      for (const child of Array.from(_deskSessionList.children)) {
        if (child.classList.contains("desk-section-label")) {
          items.push({ label: child.textContent.trim(), section: true });
        } else if (child.classList.contains("desk-swipe-row")) {
          const row = child.querySelector(".desk-session-row");
          const href = row?.dataset.openHref || "";
          if (!row || !href) continue;
          items.push({
            label: (row.querySelector(".desk-row-name")?.textContent || row.dataset.sessionName || "").trim(),
            current: row.classList.contains("is-selected"),
            href,
            name: row.dataset.sessionName || "",
          });
        }
      }
      if (!items.some((it) => !it.section)) return;
      _deskSessionSwitcherItems = items;
      const rect = _deskAppSidebarToggle.getBoundingClientRect();
      _deskSessionSwitcherOpen = true;
      try {
        await invoke("show_session_switcher_menu", {
          payload: {
            x: Math.round(rect.right || 0),
            y: Math.round(rect.top || 0),
            items: items.map(({ label, section, current }) => ({ label, section: !!section, current: !!current })),
          },
        });
      } catch (_) {
      } finally {
        _deskSessionSwitcherOpen = false;
      }
    }

    // Fit Height to Message: the right panel can't paint past the tiny window,
    // so its toggle pops the uncommitted-file list through a native menu. The
    // list lives in the chat frame; ask it, then build the menu.
    let _deskGitChangesItems = [];
    let _deskGitChangesOpen = false;
    function requestDeskGitChanges(timeoutMs = 4000) {
      return new Promise((resolve) => {
        const frameWin = _deskChatFrame?.contentWindow;
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
        items.push({ label: `${base(f.path)}${stat}`, path: f.path, untracked: f.untracked });
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
      const invoke = getTauriInvoke();
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
      if (detail.action === "switchSession") {
        const item = _deskSessionSwitcherItems[Number(detail.mode)];
        if (item && item.href) openSessionFrame(item.href, item.name);
        return;
      }
      if (detail.action === "gitChange") {
        const item = _deskGitChangesItems[Number(detail.mode)];
        if (item && item.path) {
          _deskChatFrame?.contentWindow?.postMessage(
            { type: "desk-open-git-file", path: item.path, untracked: !!item.untracked }, "*",
          );
        }
        return;
      }
      if (detail.action === "renameSession") {
        if (_deskContextSessionName) beginDeskSessionRename(_deskContextSessionName);
        return;
      }
      if (detail.action === "copyWorkspacePath") {
        if (_deskContextSessionName) void copyDeskSessionWorkspace(_deskContextSessionName);
        return;
      }
      if (detail.action === "changeWorkspace") {
        if (_deskContextSessionName) void changeDeskSessionWorkspace(_deskContextSessionName);
        return;
      }
      if (detail.action === "resetAgents") {
        if (_deskContextSessionName) void resetDeskSessionAgents(_deskContextSessionName);
        return;
      }
      if (detail.action === "archiveSession") {
        if (_deskContextSessionName) void runDeskContextAction(_deskContextSessionName, "kill");
        return;
      }
      if (detail.action === "deleteSession") {
        if (_deskContextSessionName) void runDeskContextAction(_deskContextSessionName, "delete-archived");
        return;
      }
      if (detail.action === "reviveSession") {
        if (_deskContextSessionName) {
          openSessionFrame(
            `/revive-session?session=${encodeURIComponent(_deskContextSessionName)}`,
            _deskContextSessionName,
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
      if (detail.action === "theme") {
        const theme = String(detail.theme || "").trim().toLowerCase();
        if (theme !== "system" && theme !== "light" && theme !== "dark") return;
        applyIncomingThemeDesktop(theme);
        try { localStorage.setItem(DESK_THEME_KEY, theme); } catch (_) {}
        return;
      }
      dispatchDeskNativeMenuAction(detail);
    });
