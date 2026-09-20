    let _fileAutocompleteRequestSeq = 0;
__CHAT_INCLUDE:../file-resolve.js__
    const fileDrop = document.getElementById("fileDropdown");
    let _dropActiveIdx = -1;
    let _ignoreGlobalClick = false;
    const _dropItems = () => fileDrop.querySelectorAll(".file-item");
    const closeDrop = () => {
      cancelFileAutocompleteLoading();
      _fileAutocompleteRequestSeq += 1;
      fileDrop.classList.remove("visible", "is-scrollable");
      fileDrop.style.display = "none";
      _dropActiveIdx = -1;
    };
    document.addEventListener("composer-overlay-close-start", closeDrop);
__CHAT_INCLUDE:../file-autocomplete.js__
    const LINKIFY_INLINE_CODE_CHUNK = 20;
    let _linkifyInlineCodeRunSeq = 0;
    let _linkifyDebounceTimer = null;
    let _linkifyDebouncedScope = null;
    const LINKIFY_POST_RENDER_DEBOUNCE_MS = 50;
    const linkifyInlineCodeFileRefsImmediate = (scope = document) => {
      if (!scope?.querySelectorAll) return;
      const snapshot = [];
      scope.querySelectorAll(".md-body code").forEach((codeEl) => {
        if (!codeEl || codeEl.closest("pre")) return;
        if (codeEl.closest("a")) return;
        if (codeEl.closest(".streaming-body-reveal")) return;
        snapshot.push(codeEl);
      });
      if (!snapshot.length) return;
      const runId = ++_linkifyInlineCodeRunSeq;
      const parsedEntries = snapshot.map((codeEl) => ({
        codeEl,
        token: parseInlineCodeFileToken(codeEl.textContent || ""),
      }));
      const queries = parsedEntries.map((item) => item.token || "").filter(Boolean);
      if (!queries.length) return;
      void resolveInlineCodeFilePaths(queries).then((resolvedMap) => {
        if (runId !== _linkifyInlineCodeRunSeq) return;
        const normalizedMap = new Map();
        resolvedMap.forEach((value, key) => {
          const normalized = normalizeWorkspaceFilePath(value) || value;
          if (normalized) normalizedMap.set(key, normalized);
        });
        let i = 0;
        const processEl = (entry) => {
          const codeEl = entry.codeEl;
          const token = entry.token;
          if (!token || !codeEl?.isConnected) return;
          const path = normalizedMap.get(token) || "";
          if (!path) return;
          const anchor = document.createElement("a");
          anchor.className = "inline-file-link";
          anchor.href = fileViewHrefForPath(path);
          anchor.dataset.filepath = path;
          anchor.dataset.ext = extFromPath(path);
          anchor.title = path;
          const codeClone = codeEl.cloneNode(true);
          anchor.appendChild(codeClone);
          codeEl.replaceWith(anchor);
        };
        const pump = () => {
          if (runId !== _linkifyInlineCodeRunSeq) return;
          const end = Math.min(i + LINKIFY_INLINE_CODE_CHUNK, parsedEntries.length);
          while (i < end) {
            processEl(parsedEntries[i++]);
          }
          if (i < parsedEntries.length) {
            requestAnimationFrame(pump);
          }
        };
        pump();
      });
    };
    const linkifyInlineCodeFileRefs = (scope = document) => {
      if (!scope?.querySelectorAll) return;
      _linkifyDebouncedScope = scope;
      if (_linkifyDebounceTimer) return;
      _linkifyDebounceTimer = setTimeout(() => {
        _linkifyDebounceTimer = null;
        const s = _linkifyDebouncedScope;
        _linkifyDebouncedScope = null;
        if (s?.querySelectorAll) linkifyInlineCodeFileRefsImmediate(s);
      }, LINKIFY_POST_RENDER_DEBOUNCE_MS);
    };
    const buildAutocompleteFileItem = (entry) => {
      const path = String(entry?.path || "");
      const ext = fileExtForPath(path);
      const icon = FILE_ICONS[ext] || FILE_SVG_ICONS.file;
      const label = (displayAttachmentFilename(path) || basename(path) || path).trim() || path;
      const relDir = composerAutocompleteRelativeDir(path);
      const row = document.createElement("div");
      row.className = "file-item";
      row.dataset.path = path;
      const pathInner = relDir
        ? `<span class="file-item-name">${escapeHtml(label)}</span><span class="file-item-relpath">${escapeHtml(relDir)}</span>`
        : `<span class="file-item-name">${escapeHtml(label)}</span>`;
      row.innerHTML =
        `<span class="file-item-icon">${icon}</span>` +
        `<span class="file-item-path">${pathInner}</span>` +
        `<span class="file-item-size">${escapeHtml(formatFileSize(entry?.size))}</span>`;
      return row;
    };
    const selectFile = (path) => {
      const ta = messageInput;
      const pos = ta.selectionStart;
      const before = ta.value.slice(0, pos);
      const atIdx = before.lastIndexOf("@");
      if (atIdx === -1) return closeDrop();
      const inlineRef = "`" + path + "`";
      ta.value = ta.value.slice(0, atIdx) + inlineRef + ta.value.slice(pos);
      composing = false;
      const newPos = atIdx + inlineRef.length;
      ta.setSelectionRange(newPos, newPos);
      focusMessageInputWithoutScroll(newPos, newPos);
      _ignoreGlobalClick = true;
      closeDrop();
    };
    fileDrop.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = e.target.closest(".file-item");
      if (!item) return;
      const items = _dropItems();
      items.forEach((node) => node.classList.remove("active"));
      item.classList.add("active");
      _dropActiveIdx = Array.prototype.indexOf.call(items, item);
      const path = item.dataset.path;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => selectFile(path));
      });
    });
    if (isMobileComposer) {
      const clearFilePressed = () => {
        _dropItems().forEach((node) => node.classList.remove("is-pressed"));
      };
      fileDrop.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const item = e.target.closest(".file-item");
        if (!item) return;
        clearFilePressed();
        item.classList.add("is-pressed");
      });
      fileDrop.addEventListener("pointerout", (e) => {
        const item = e.target.closest(".file-item");
        if (!item) return;
        const next = e.relatedTarget;
        if (!next || item.contains(next)) return;
        item.classList.remove("is-pressed");
      });
      document.addEventListener("pointercancel", clearFilePressed, true);
    }
    fileDrop.addEventListener("mousedown", (e) => {
      if (e.target.closest(".file-item")) e.preventDefault();
    });
    const autoResizeTextarea = () => {
      const inputStyle = getComputedStyle(messageInput);
      const baseHeight = parseFloat(inputStyle.minHeight);
      const maxHeight = parseFloat(inputStyle.maxHeight);
      messageInput.style.height = "auto";
      const nextHeight = Math.min(maxHeight, Math.max(baseHeight, messageInput.scrollHeight));
      messageInput.style.height = nextHeight + "px";
      const scrollable = nextHeight >= maxHeight;
      messageInput.style.overflowY = scrollable ? "auto" : "hidden";
      messageInput.classList.toggle("is-scrollable", scrollable);
      if (isMobileComposer) {
        messageInput.style.marginTop = (baseHeight - nextHeight) + "px";
        composerShellEl?.style.setProperty("--composer-input-rise", Math.max(0, nextHeight - baseHeight) + "px");
      } else {
        messageInput.style.marginTop = "0px";
      }
      if (scrollable && messageInput.value.length - messageInput.selectionEnd <= 1) {
        messageInput.scrollTop = messageInput.scrollHeight;
      }
      if (isMobileComposer && isComposerOverlayOpen() && attachPreviewRow?.children.length) {
        positionComposerDropdown(attachPreviewRow);
      }
    };
    const positionComposerDropdown = (dropdown) => {
      if (!dropdown || !isMobileComposer) return;
      const taRect = messageInput.getBoundingClientRect();
      if (!taRect.width && !taRect.height) return;
      const composerTransform = getComputedStyle(composerForm).transform;
      const composerOffsetY = composerTransform === "none" ? 0 : new DOMMatrixReadOnly(composerTransform).m42;
      const taTop = taRect.top - composerOffsetY;
      const aboveInput = document.querySelector(".composer-above-input");
      let aboveInputHeight = aboveInput ? Math.max(0, Math.ceil(aboveInput.getBoundingClientRect().height)) : 0;
      if (dropdown !== attachPreviewRow && attachPreviewRow?.children.length) {
        aboveInputHeight += Math.max(0, Math.ceil(attachPreviewRow.getBoundingClientRect().height));
      }
      const gap = 8;
      const availableSpace = Math.max(96, taTop - aboveInputHeight - 20);
      dropdown.style.left = taRect.left + "px";
      dropdown.style.width = taRect.width + "px";
      dropdown.style.minWidth = "0";
      dropdown.style.bottom = Math.max(12, window.innerHeight - taTop + gap + aboveInputHeight) + "px";
      const menuMax = parseFloat(getComputedStyle(dropdown).getPropertyValue("--composer-menu-max-height"));
      dropdown.style.maxHeight = Math.min(menuMax, availableSpace) + "px";
      if (dropdown.id === "fileDropdown" || dropdown.id === "cmdDropdown") {
        requestAnimationFrame(() => {
          dropdown.classList.toggle(
            "is-scrollable",
            dropdown.scrollHeight > dropdown.clientHeight,
          );
        });
      }
    };
    document.addEventListener("composer-overlay-open", () => {
      if (!isMobileComposer || !attachPreviewRow?.children.length) return;
      const reposition = () => positionComposerDropdown(attachPreviewRow);
      if (composerForm?.classList.contains("composer-focus-hack")) requestAnimationFrame(reposition);
      else reposition();
    });
    messageInput.addEventListener("input", () => {
      autoResizeTextarea();
    });
    if (typeof ResizeObserver === "function") {
      let _composerWidthForResize = messageInput.getBoundingClientRect().width;
      new ResizeObserver((entries) => {
        const width = entries[entries.length - 1].contentRect.width;
        if (width === _composerWidthForResize) return;
        _composerWidthForResize = width;
        autoResizeTextarea();
      }).observe(messageInput);
    } else {
      window.addEventListener("resize", autoResizeTextarea);
    }
    const updateFileAutocomplete = async () => {
      if (!isComposerOverlayOpen()) {
        closeDrop();
        return;
      }
      const requestSeq = ++_fileAutocompleteRequestSeq;
      const pos = messageInput.selectionEnd;
      const val = messageInput.value;
      const before = val.slice(0, pos);
      const match = before.match(/@[\w.\/-]*$/);

      if (!match || match[0].startsWith("@/")) {
        if (requestSeq === _fileAutocompleteRequestSeq) closeDrop();
        return;
      }

      const query = match[0].slice(1);
      scheduleFileAutocompleteLoading(requestSeq);
      const matches = await loadFileSearchMatches(query, 30);
      cancelFileAutocompleteLoading();
      if (requestSeq !== _fileAutocompleteRequestSeq) return;

      if (!matches.length) {
        closeDrop();
        return;
      }

      fileDrop.replaceChildren();
      const list = document.createElement("div");
      list.className = "file-dropdown-list";
      matches.forEach((entry) => list.appendChild(buildAutocompleteFileItem(entry)));
      fileDrop.appendChild(list);

      _dropActiveIdx = -1;
      positionComposerDropdown(fileDrop);
      if (!fileDrop.classList.contains("visible")) {
        fileDrop.style.display = "block";
        fileDrop.classList.add("visible");
      }
    };

    messageInput.addEventListener("input", updateFileAutocomplete);
    messageInput.addEventListener("click", () => setTimeout(updateFileAutocomplete, 10));
    messageInput.addEventListener("focus", () => {
      updateFileAutocomplete();
    });
    messageInput.addEventListener("keydown", (e) => {
      if (fileDrop.style.display === "none") return;
      const items = _dropItems();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[_dropActiveIdx]?.classList.remove("active");
        _dropActiveIdx = Math.min(_dropActiveIdx + 1, items.length - 1);
        items[_dropActiveIdx]?.classList.add("active");
        items[_dropActiveIdx]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[_dropActiveIdx]?.classList.remove("active");
        _dropActiveIdx = Math.max(_dropActiveIdx - 1, 0);
        items[_dropActiveIdx]?.classList.add("active");
        items[_dropActiveIdx]?.scrollIntoView({ block: "nearest" });
      } else if ((e.key === "Enter" || e.key === "Tab") && _dropActiveIdx >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        selectFile(items[_dropActiveIdx].dataset.path);
      } else if (e.key === "Escape") {
        closeDrop();
      }
    }, true);

    const cmdDrop = document.getElementById("cmdDropdown");
