    let _cmdActiveIdx = -1;
    let _lastCmdItemsData = [];
    let cancelCmdAutocompleteLoading = () => {};
    const _cmdItems = () => cmdDrop.querySelectorAll(".cmd-item");
    const showCmdAutocompleteLoading = () => {
      cmdDrop.innerHTML = `<div class="file-dropdown-loading">${loadingIndicatorHtml()}</div>`;
      _cmdActiveIdx = -1;
      positionComposerDropdown(cmdDrop);
      if (!cmdDrop.classList.contains("visible")) {
        cmdDrop.style.display = "block";
        cmdDrop.classList.add("visible");
      }
    };
    const scheduleCmdAutocompleteLoading = (contextKey) => {
      cancelCmdAutocompleteLoading();
      cancelCmdAutocompleteLoading = startDelayedLoading(
        showCmdAutocompleteLoading,
        () => _lastCmdQuery !== contextKey,
      );
    };
    const closeCmdDrop = () => {
      cancelCmdAutocompleteLoading();
      cmdDrop.classList.remove("visible", "is-scrollable");
      cmdDrop.style.display = "none";
      _cmdActiveIdx = -1;
    };
    document.addEventListener("composer-overlay-close-start", closeCmdDrop);
    const selectCmd = (idx) => {
      const item = _lastCmdItemsData[idx];
      if (!item) return;
      if (item.insert) {
        const start = Number(item.replaceStart);
        const end = Number(item.replaceEnd);
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          messageInput.value.slice(start, end).toLowerCase() !== item.query
        ) {
          closeCmdDrop();
          return;
        }
        messageInput.value = messageInput.value.slice(0, start) + item.insert + messageInput.value.slice(end);
        const newPos = start + item.insert.length;
        autoResizeTextarea();
        closeCmdDrop();
        focusMessageInputWithoutScroll(newPos);
        return;
      }
      if (item.has_arg) {
        messageInput.value = item.slash + " ";
        autoResizeTextarea();
        closeCmdDrop();
        focusMessageInputWithoutScroll(messageInput.value.length);
        return;
      }
      messageInput.value = "";
      autoResizeTextarea();
      closeCmdDrop();
      void submitMessage({ closeOverlayOnStart: true, forcedText: item.slash });
    };
    let _lastCmdQuery = "";
    const updateCmdAutocomplete = () => {
      const pos = messageInput.selectionEnd;
      const val = messageInput.value;
      const before = val.slice(0, pos);
      const match = before.match(/(^|[^A-Za-z0-9._\/-])(\/[\w-]*)$/);
      if (!match) {
        _lastCmdQuery = "";
        closeCmdDrop();
        return;
      }
      const token = match[2];
      const tokenStart = pos - token.length;
      const atInputStart = tokenStart === 0;
      const query = token.toLowerCase();
      const contextKey = `${pos}:${before}`;
      _lastCmdQuery = contextKey;
      scheduleCmdAutocompleteLoading(contextKey);
      void (async () => {
        let list;
        try {
          list = await loadShortcutCommandsOnce();
        } catch (err) {
          cancelCmdAutocompleteLoading();
          closeCmdDrop();
          setStatus(err?.message || "Commands unavailable");
          return;
        }
        cancelCmdAutocompleteLoading();
        if (_lastCmdQuery !== contextKey) return;
        const matches = list.filter((c) => {
          const slash = String(c.slash || "").toLowerCase();
          return (atInputStart || c.insert) && (!query || query === "/" || slash.startsWith(query));
        });
        if (!matches.length) {
          closeCmdDrop();
          return;
        }
        _lastCmdItemsData = matches.map((c) => ({
          id: c.id,
          slash: c.slash,
          desc: c.desc,
          has_arg: !!c.has_arg,
          path: c.path,
          insert: c.insert || "",
          replaceStart: tokenStart,
          replaceEnd: pos,
          query,
          type: "command",
          label: c.slash,
        }));
        cmdDrop.innerHTML =
          `<div class="cmd-dropdown-list">` +
          _lastCmdItemsData.map((c, i) =>
            `<div class="cmd-item" data-idx="${i}">` +
            `<span class="cmd-item-name">${escapeHtml(c.label)}</span>` +
            `<span class="cmd-item-desc">${escapeHtml(c.desc)}</span>` +
            `</div>`
          ).join("") +
          `</div>`;
        _cmdActiveIdx = -1;
        positionComposerDropdown(cmdDrop);
        if (!cmdDrop.classList.contains("visible")) {
          cmdDrop.style.display = "block";
          cmdDrop.classList.add("visible");
        }
      })();
    };
    messageInput.addEventListener("input", updateCmdAutocomplete);
    cmdDrop.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = e.target.closest(".cmd-item");
      if (!item) return;
      const idx = parseInt(item.dataset.idx, 10);
      _cmdItems().forEach((node) => node.classList.remove("active"));
      item.classList.add("active");
      _cmdActiveIdx = idx;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => selectCmd(idx));
      });
    });
    if (isMobileComposer) {
      const clearCmdPressed = () => {
        _cmdItems().forEach((node) => node.classList.remove("is-pressed"));
      };
      cmdDrop.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const item = e.target.closest(".cmd-item");
        if (!item) return;
        clearCmdPressed();
        item.classList.add("is-pressed");
      });
      cmdDrop.addEventListener("pointerout", (e) => {
        const item = e.target.closest(".cmd-item");
        if (!item) return;
        const next = e.relatedTarget;
        if (!next || item.contains(next)) return;
        item.classList.remove("is-pressed");
      });
      document.addEventListener("pointercancel", clearCmdPressed, true);
    }
    cmdDrop.addEventListener("mousedown", (e) => {
      if (e.target.closest(".cmd-item")) e.preventDefault();
    });
    messageInput.addEventListener("keydown", (e) => {
      if (cmdDrop.style.display === "none" || !cmdDrop.classList.contains("visible")) return;
      const items = _cmdItems();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[_cmdActiveIdx]?.classList.remove("active");
        _cmdActiveIdx = Math.min(_cmdActiveIdx + 1, items.length - 1);
        items[_cmdActiveIdx]?.classList.add("active");
        items[_cmdActiveIdx]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[_cmdActiveIdx]?.classList.remove("active");
        _cmdActiveIdx = Math.max(_cmdActiveIdx - 1, 0);
        items[_cmdActiveIdx]?.classList.add("active");
        items[_cmdActiveIdx]?.scrollIntoView({ block: "nearest" });
      } else if ((e.key === "Enter" || e.key === "Tab") && _cmdActiveIdx >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        selectCmd(parseInt(items[_cmdActiveIdx].dataset.idx, 10));
      } else if (e.key === "Escape") {
        closeCmdDrop();
      }
    }, true);

    const doCopyFallback = (text) => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(ta);
      return copied ? Promise.resolve() : Promise.reject(new Error("clipboard unavailable"));
    };
    const doCopyText = (text) => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(() => doCopyFallback(text));
      }
      return doCopyFallback(text);
    };
    const markCopied = (btn, holdMs = 1500, onEnded) => {
      if (!btn) return;
      const copyIcon = btn.dataset.copyIcon || btn.innerHTML;
      const checkIcon = btn.dataset.checkIcon || btn.innerHTML;
      const token = String(Date.now() + Math.random());
      btn.dataset.copyAnimToken = token;
      
      btn.innerHTML = checkIcon;
      btn.classList.add("copied");
      
      setTimeout(() => {
        if (btn.dataset.copyAnimToken !== token) return;
        onEnded?.();
        const restoreIcon = () => {
          if (btn.dataset.copyAnimToken !== token) return;
          btn.classList.remove("copied");
          btn.innerHTML = copyIcon;
        };
        if (onEnded) setTimeout(restoreIcon, 120);
        else restoreIcon();
      }, holdMs);
    };
    const messagesEl = document.getElementById("messages");
    let revealMobileCopy = null;
    let hideMobileCopy = null;
    if (document.documentElement.dataset.mobile === "1") {
      let revealedCopyRow = null;
      let revealCopyTimer = 0;
      hideMobileCopy = () => {
        revealedCopyRow?.classList.remove("is-copy-revealed");
        revealedCopyRow = null;
        clearTimeout(revealCopyTimer);
        revealCopyTimer = 0;
      };
      revealMobileCopy = (row) => {
        if (revealedCopyRow && revealedCopyRow !== row) {
          revealedCopyRow.classList.remove("is-copy-revealed");
        }
        revealedCopyRow = row;
        row.classList.add("is-copy-revealed");
        clearTimeout(revealCopyTimer);
        revealCopyTimer = setTimeout(hideMobileCopy, 3000);
      };
    } else {
      let activeHoverCopyBody = null;
      let hoverCopyBody = null;
      let hoverCopyRect = null;
      const clearHoverCopyBody = () => {
        if (activeHoverCopyBody) {
          activeHoverCopyBody.classList.remove("is-hover-copy-hotspot");
        }
        activeHoverCopyBody = null;
        hoverCopyBody = null;
        hoverCopyRect = null;
      };
      messagesEl.addEventListener("pointermove", (e) => {
        const bodyRow = e.target.closest(".message-row .message-body-row");
        if (!bodyRow) {
          clearHoverCopyBody();
          return;
        }
        if (hoverCopyBody !== bodyRow) {
          hoverCopyBody = bodyRow;
          hoverCopyRect = bodyRow.getBoundingClientRect();
        }
        const rect = hoverCopyRect;
        if (!rect?.width) {
          clearHoverCopyBody();
          return;
        }
        const inHotspot = e.clientX >= rect.left + rect.width * (2 / 3);
        if (!inHotspot) {
          if (activeHoverCopyBody === bodyRow) clearHoverCopyBody();
          return;
        }
        if (activeHoverCopyBody === bodyRow) return;
        if (activeHoverCopyBody && activeHoverCopyBody !== bodyRow) {
          activeHoverCopyBody.classList.remove("is-hover-copy-hotspot");
        }
        activeHoverCopyBody = bodyRow;
        bodyRow.classList.add("is-hover-copy-hotspot");
      });
      messagesEl.addEventListener("pointerleave", clearHoverCopyBody);
      timeline?.addEventListener("scroll", clearHoverCopyBody, { passive: true });
      window.addEventListener("resize", clearHoverCopyBody, { passive: true });
    }
    const openExternalLink = (href) => {
      if (document.documentElement.dataset.tauriApp === "1") {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "open-external-url", url: href }, "*");
          return Promise.resolve();
        }
        const invoke = window.__TAURI__?.core?.invoke;
        if (typeof invoke === "function") return invoke("open_external_url", { url: href });
        return Promise.reject(new Error("Tauri external-link bridge is unavailable"));
      }
      window.open(href, "_blank", "noopener,noreferrer");
      return Promise.resolve();
    };
    const reportExternalLinkFailure = () => setStatus("Link failed");
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent || event.data?.type !== "external-url-open-failed") return;
      reportExternalLinkFailure();
    });
    messagesEl.addEventListener("click", (e) => {
      const anyLink = e.target.closest("a[href]");
      if (anyLink) {
        const href = anyLink.getAttribute("href");
        const path = filePathFromLinkAnchor(anyLink);
        if (path) {
          e.preventDefault();
          e.stopPropagation();
          if (document.documentElement.dataset.mobile !== "1" && anyLink.dataset.fileLinkOpen === "editor") {
            void openFile(path);
            return;
          }
          void openFileSurface(path, extFromPath(path), anyLink, e);
          return;
        }
        if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
          e.preventDefault();
          e.stopPropagation();
          void openExternalLink(href).catch(reportExternalLinkFailure);
          return;
        }
      }
      const collapseToggle = e.target.closest(".message-collapse-toggle");
      if (collapseToggle) {
        const row = collapseToggle.closest("article.message-row");
        const contextHash = row?.dataset.contextHash || "";
        if (!row || !contextHash || !isCollapsibleMessageRow(row)) return;
        if (expandedMessageBodies.has(contextHash)) {
          expandedMessageBodies.delete(contextHash);
        } else {
          expandedMessageBodies.add(contextHash);
        }
        syncMessageCollapse(row);
        return;
      }
      const codeCopyBtn = e.target.closest(".code-copy-btn");
      if (codeCopyBtn) {
        const wrap = codeCopyBtn.closest(".code-block-wrap");
        if (!wrap) return;
        const code = wrap.querySelector("code") || wrap.querySelector("pre");
        doCopyText(code.textContent).then(() => {
          markCopied(codeCopyBtn);
        }).catch((err) => setStatus(`copy failed: ${err.message}`));
        return;
      }
      const btn = e.target.closest(".copy-btn");
      if (btn) {
        e.preventDefault();
        const raw = btn.closest(".message")?.dataset.raw ?? "";
        const row = btn.closest("article.message-row");
        doCopyText(raw).then(() => {
          if (revealMobileCopy && row) {
            revealMobileCopy(row);
            markCopied(btn, 3000, hideMobileCopy);
          } else {
            markCopied(btn, 3000);
          }
        }).catch((err) => setStatus(`copy failed: ${err.message}`));
        return;
      }
      if (!revealMobileCopy) return;
      const row = e.target.closest("article.message-row");
      if (row) revealMobileCopy(row);
    });
    if (document.documentElement.dataset.mobile !== "1") {
      messagesEl.addEventListener("mousedown", (e) => {
        if (e.button !== 2) return;
        if (!e.target.closest("a.inline-file-link, a.local-file-link")) return;
        e.preventDefault();
      }, true);
      messagesEl.addEventListener("contextmenu", (e) => {
        const anyLink = e.target.closest("a[href]");
        if (!anyLink) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (!anyLink.classList.contains("inline-file-link") && !anyLink.classList.contains("local-file-link")) return;
        window.getSelection()?.removeAllRanges();
        const path = filePathFromLinkAnchor(anyLink);
        if (path) void dpOpenFileContextMenu(path, e);
      }, true);
      messagesEl.addEventListener("auxclick", (e) => {
        if (e.button !== 1) return;
        const anyLink = e.target.closest("a[href]");
        if (!anyLink) return;
        const href = anyLink.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
        e.preventDefault();
        e.stopPropagation();
        void openExternalLink(href).catch(reportExternalLinkFailure);
      });
    }
