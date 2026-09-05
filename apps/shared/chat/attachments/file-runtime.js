    let _fileAutocompleteRequestSeq = 0;
__CHAT_INCLUDE:../file-resolve.js__
    const fileDrop = document.getElementById("fileDropdown");
    let _dropActiveIdx = -1;
    let _ignoreGlobalClick = false;
    let _dropTimeout = null;
    const _dropItems = () => fileDrop.querySelectorAll(".file-item");
    const closeDrop = ({ immediate = false } = {}) => {
      if (immediate) {
        if (_dropTimeout) {
          clearTimeout(_dropTimeout);
          _dropTimeout = null;
        }
        fileDrop.classList.remove("visible", "closing");
        fileDrop.style.display = "none";
        _dropActiveIdx = -1;
        return;
      }
      if (fileDrop.classList.contains("visible")) {
        fileDrop.classList.remove("visible");
        fileDrop.classList.add("closing");
        if (_dropTimeout) clearTimeout(_dropTimeout);
        _dropTimeout = setTimeout(() => {
          if (fileDrop.classList.contains("closing")) {
            fileDrop.style.display = "none";
            fileDrop.classList.remove("closing");
          }
          _dropTimeout = null;
        }, 160);
      } else if (!fileDrop.classList.contains("closing")) {
        fileDrop.style.display = "none";
      }
      _dropActiveIdx = -1;
    };
    document.addEventListener("composer-overlay-close-start", () => closeDrop({ immediate: true }));
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
      // relpath before name, in real-path order (dir/subdir/file) -- the pair
      // truncates from the left as one unit (see .file-item-path), so which
      // end survives depends on this order, not on any styling.
      const pathInner = relDir
        ? `<span class="file-item-relpath">${escapeHtml(relDir)}/</span><span class="file-item-name">${escapeHtml(label)}</span>`
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
      const newPos = atIdx + inlineRef.length;
      ta.setSelectionRange(newPos, newPos);
      focusMessageInputWithoutScroll(newPos, newPos);
      _ignoreGlobalClick = true;
      closeDrop();
    };
    fileDrop.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    fileDrop.addEventListener("mousedown", (e) => {
      const item = e.target.closest(".file-item");
      if (item) { e.preventDefault(); selectFile(item.dataset.path); }
    });
    const autoResizeTextarea = () => {
      const baseHeight = isMobileComposer ? 54 : 52;
      const maxHeight = 200;
      messageInput.style.height = "auto";
      const nextHeight = Math.min(maxHeight, Math.max(baseHeight, messageInput.scrollHeight));
      messageInput.style.height = nextHeight + "px";
      const scrollable = nextHeight >= maxHeight;
      messageInput.style.overflowY = scrollable ? "auto" : "hidden";
      // Mobile's top/bottom fade mask is only meaningful once the field is
      // actually capped and scrolling -- applied unconditionally it washed
      // out a normal one-line message too (its text sits inside the fade
      // band of a field that never scrolls).
      messageInput.classList.toggle("is-scrollable", scrollable);
      if (isMobileComposer) {
        messageInput.style.marginTop = (baseHeight - nextHeight) + "px";
        composerShellEl?.style.setProperty("--composer-input-rise", Math.max(0, nextHeight - baseHeight) + "px");
      } else {
        messageInput.style.marginTop = "0px";
      }
      // The height = "auto" round-trip drops scrollTop to 0. Once the field is
      // capped and scrolls, that leaves the just-typed last line a few px below
      // the fold (and the desktop scrollbar is hidden, so there's no cue).
      // Follow the caret back down whenever it's sitting at the end.
      if (scrollable && messageInput.value.length - messageInput.selectionEnd <= 1) {
        messageInput.scrollTop = messageInput.scrollHeight;
      }
    };
    // Mobile retains the original fixed dropdowns outside the transformed
    // composer. Desktop's dropdowns are composer children and need no JS
    // positioning at all.
    const positionComposerDropdown = (dropdown) => {
      if (!dropdown || !isMobileComposer) return;
      const taRect = messageInput.getBoundingClientRect();
      const aboveInput = document.querySelector(".composer-above-input");
      const aboveInputHeight = aboveInput ? Math.max(0, Math.ceil(aboveInput.getBoundingClientRect().height)) : 0;
      const gap = 8;
      const availableSpace = Math.max(96, taRect.top - aboveInputHeight - 20);
      dropdown.style.left = taRect.left + "px";
      dropdown.style.width = taRect.width + "px";
      dropdown.style.minWidth = "0";
      dropdown.style.bottom = Math.max(12, window.innerHeight - taRect.top + gap + aboveInputHeight) + "px";
      dropdown.style.maxHeight = Math.min(208, availableSpace) + "px";
    };
    messageInput.addEventListener("input", () => {
      autoResizeTextarea();
    });
    if (typeof ResizeObserver === "function") {
      let _composerWidthForResize = messageInput.getBoundingClientRect().width;
      new ResizeObserver((entries) => {
        const width = entries[entries.length - 1].contentRect.width;
        if (width === _composerWidthForResize) return;
        _composerWidthForResize = width;
        // A width change (e.g. the right panel opening) reflows the text and
        // can change how many lines it needs; autoResizeTextarea keeps the
        // caret in view when it's at the end.
        autoResizeTextarea();
      }).observe(messageInput);
    } else {
      window.addEventListener("resize", autoResizeTextarea);
    }
    const updateFileAutocomplete = async () => {
      const requestSeq = ++_fileAutocompleteRequestSeq;
      const pos = messageInput.selectionEnd;
      const val = messageInput.value;
      const before = val.slice(0, pos);
      const match = before.match(/@[\w.\/-]*$/);

      if (!match) {
        if (requestSeq === _fileAutocompleteRequestSeq) closeDrop();
        return;
      }

      const query = match[0].slice(1);
      showFileAutocompleteLoading();
      const matches = await loadFileSearchMatches(query, 30);
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
        if (_dropTimeout) { clearTimeout(_dropTimeout); _dropTimeout = null; }
        fileDrop.classList.remove("closing");
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
