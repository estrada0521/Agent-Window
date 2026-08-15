    let _fileImportInProgress = false;
    let _fileImportClearTimer = null;

    const attachBtn = document.getElementById("attachBtn");
    const attachInput = document.getElementById("attachInput");
    const attachPreviewRow = document.getElementById("attachPreviewRow");
    const composerShellEl = document.querySelector(".composer-shell");
    if (attachBtn && attachInput && attachPreviewRow) {
      const addCard = (file, attachment) => {
        const card = document.createElement("div");
        card.className = "attach-card";
        if (file.type.startsWith("image/")) {
          const img = document.createElement("img");
          img.className = "attach-card-thumb";
          img.src = URL.createObjectURL(file);
          img.alt = file.name;
          card.appendChild(img);
        } else {
          const ext = document.createElement("div");
          ext.className = "attach-card-ext";
          ext.textContent = file.name.split(".").pop().slice(0, 5) || "FILE";
          card.appendChild(ext);
        }

        const rmBtn = document.createElement("button");
        rmBtn.type = "button";
        rmBtn.className = "attach-card-remove";
        rmBtn.setAttribute("aria-label", "Remove");
        rmBtn.textContent = "\u2715";
        rmBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          pendingAttachments = pendingAttachments.filter((a) => a !== attachment);
          card.remove();
          if (!attachPreviewRow.children.length) attachPreviewRow.style.display = "none";
          if (attachment.path) {
            fetch("/delete-upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: attachment.path }),
            }).catch(() => {});
          }
        });
        card.appendChild(rmBtn);
        attachPreviewRow.appendChild(card);
        attachPreviewRow.style.display = "flex";
      };
      __CHAT_INCLUDE:../../../../shared/chat/upload-attached-files.js__
      const dtHasFiles = (dt) => dt && [...dt.types].includes("Files");
      const isOnFileInputDrop = (t) => !!(t && t.closest && t.closest("input[type=file]"));
      const maybeOpenComposerForAttachDrag = () => {
        if (!isComposerOverlayOpen()) openComposerOverlay({ immediateFocus: false });
      };
      let attachDragClearTimer = 0;
      const showComposerAttachDrag = () => {
        if (attachDragClearTimer) {
          clearTimeout(attachDragClearTimer);
          attachDragClearTimer = 0;
        }
        maybeOpenComposerForAttachDrag();
        composerOverlay?.classList.add("composer-attach-drag");
      };
      const hideComposerAttachDrag = ({ immediate = false } = {}) => {
        if (attachDragClearTimer) {
          clearTimeout(attachDragClearTimer);
          attachDragClearTimer = 0;
        }
        if (immediate) {
          composerOverlay?.classList.remove("composer-attach-drag");
          return;
        }
        attachDragClearTimer = setTimeout(() => {
          composerOverlay?.classList.remove("composer-attach-drag");
          attachDragClearTimer = 0;
        }, 120);
      };
      window.addEventListener("message", async (event) => {
        if (event.source !== window.parent || !(event.data && event.data.type)) return;
        if (event.data.type === "parent-attach-drag") {
          if (event.data.active) {
            showComposerAttachDrag();
          } else {
            hideComposerAttachDrag();
          }
          return;
        }
        if (event.data.type !== "parent-drop-files") return;
        const forwardedFiles = Array.isArray(event.data.files)
          ? event.data.files.filter((file) => file && typeof file.name === "string")
          : [];
        hideComposerAttachDrag({ immediate: true });
        if (!forwardedFiles.length) return;
        maybeOpenComposerForAttachDrag();
        await uploadAttachedFiles(forwardedFiles);
      });
      attachBtn.addEventListener("click", () => {
        closePlusMenu();
        _fileImportInProgress = true;
        if (_fileImportClearTimer) clearTimeout(_fileImportClearTimer);
        _fileImportClearTimer = setTimeout(() => {
          _fileImportInProgress = false;
          _fileImportClearTimer = null;
        }, 20000);
        attachInput.click();
      });
      attachInput.addEventListener("change", async () => {
        _fileImportInProgress = false;
        if (_fileImportClearTimer) {
          clearTimeout(_fileImportClearTimer);
          _fileImportClearTimer = null;
        }
        const files = Array.from(attachInput.files);
        attachInput.value = "";
        await uploadAttachedFiles(files);
      });
      document.addEventListener("dragenter", (e) => {
        if (!dtHasFiles(e.dataTransfer) || isOnFileInputDrop(e.target)) return;
        showComposerAttachDrag();
      }, true);
      document.addEventListener("dragover", (e) => {
        if (!dtHasFiles(e.dataTransfer) || isOnFileInputDrop(e.target)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        showComposerAttachDrag();
      }, true);
      document.addEventListener("dragleave", (e) => {
        if (!composerOverlay?.classList.contains("composer-attach-drag")) return;
        if (!dtHasFiles(e.dataTransfer)) return;
        const related = e.relatedTarget;
        if (!related || !document.documentElement.contains(related)) {
          hideComposerAttachDrag();
        }
      }, true);
      document.addEventListener("dragend", () => {
        hideComposerAttachDrag({ immediate: true });
      }, true);
      document.addEventListener("drop", async (e) => {
        if (!dtHasFiles(e.dataTransfer) || isOnFileInputDrop(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        hideComposerAttachDrag({ immediate: true });
        maybeOpenComposerForAttachDrag();
        await uploadAttachedFiles(e.dataTransfer.files);
      }, true);
    }

    let composing = false;
    const messageInput = document.getElementById("message");
    const sendBtn = document.querySelector(".send-btn");
    const updateSendBtnVisibility = () => {
      if (!sessionActive) {
        if (sendBtn) sendBtn.classList.remove("visible");
        return;
      }
      const hasText = messageInput.value.trim().length > 0;
      if (sendBtn) sendBtn.classList.toggle("visible", hasText);
    };
    messageInput.addEventListener("input", updateSendBtnVisibility);

    delete document.documentElement.dataset.mobile;

    messageInput.addEventListener("compositionstart", () => {
      composing = true;
    });
    messageInput.addEventListener("compositionend", () => {
      composing = false;
      setTimeout(updateFileAutocomplete, 10);
    });
    messageInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }
      if (composing || event.isComposing || event.keyCode === 229) {
        return;
      }
      event.preventDefault();
      document.getElementById("composer").requestSubmit();
    });
