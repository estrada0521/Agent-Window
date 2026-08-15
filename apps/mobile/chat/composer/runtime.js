    let keepComposerPlusMenuOnBlur = false;
    composerPlusMenu && composerPlusMenu.addEventListener("toggle", () => {
      if (!composerPlusMenu.open) {
        composerPlusMenu.querySelectorAll(".plus-submenu").forEach(sub => { sub.open = false; });
      }
    });
    composerPlusMenu?.addEventListener("pointerdown", () => {
      keepComposerPlusMenuOnBlur = true;
      setTimeout(() => { keepComposerPlusMenuOnBlur = false; }, 240);
    });
    composerPlusMenu?.addEventListener("touchstart", () => {
      keepComposerPlusMenuOnBlur = true;
      setTimeout(() => { keepComposerPlusMenuOnBlur = false; }, 240);
    }, { passive: true });
    composerPlusMenu?.addEventListener("click", (event) => {
      const keepFocusTarget = event.target.closest(".plus-submenu-toggle, .composer-plus-panel .quick-action");
      if (!keepFocusTarget) return;
      if (event.target.closest("#cameraBtn")) return;
      requestAnimationFrame(() => {
        if (document.activeElement !== messageInput) {
          focusMessageInputWithoutScroll();
        }
      });
    });
    composerPlusMenu && composerPlusMenu.querySelectorAll(".plus-submenu").forEach(sub => {
      sub.addEventListener("toggle", () => {
        if (sub.open) {
          composerPlusMenu.querySelectorAll(".plus-submenu").forEach(other => {
            if (other !== sub) other.open = false;
          });
        }
      });
    });
    const closePlusMenu = () => {
      if (composerPlusMenu && composerPlusMenu.open) {
        composerPlusMenu.classList.add("closing");
        setTimeout(() => {
          composerPlusMenu.open = false;
          composerPlusMenu.classList.remove("closing");
        }, 160);
      }
    };
    composerPlusMenu?.querySelector(".composer-plus-toggle")?.addEventListener("mousedown", (e) => e.preventDefault());
    composerPlusMenu?.addEventListener("toggle", () => {
      if (composerPlusMenu.open) closeDrop();
    });
    const scheduleComposerCloseFromKeyboardDismiss = () => {
      clearComposerBlurCloseTimer();
      composerBlurCloseTimer = setTimeout(() => {
        if (!isComposerOverlayOpen()) return;
        const active = document.activeElement;
        if (active === messageInput) return;
        if (composerForm && active && composerForm.contains(active)) return;
        closeComposerOverlay();
      }, 140);
    };
    messageInput?.addEventListener("focus", () => {
      clearComposerBlurCloseTimer();
    });
    messageInput?.addEventListener("blur", () => {
      scheduleComposerCloseFromKeyboardDismiss();
    });
    messageInput.addEventListener("compositionstart", () => {
      composing = true;
    });
    messageInput.addEventListener("compositionend", () => {
      composing = false;
      setTimeout(updateFileAutocomplete, 10);
    });

    const cameraBtn = document.getElementById("cameraBtn");
    const cameraInput = document.getElementById("cameraInput");
    const attachPreviewRow = document.getElementById("attachPreviewRow");
    const composerShellEl = document.querySelector(".composer-shell");
    if (cameraBtn && cameraInput && attachPreviewRow) {
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
      __CHAT_INCLUDE:../../../shared/chat/upload-attached-files.js__
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
      cameraBtn.addEventListener("click", () => {
        closePlusMenu();
        closeComposerOverlay();
        cameraInput.click();
      });
      cameraInput.addEventListener("change", async () => {
        const files = Array.from(cameraInput.files);
        cameraInput.value = "";
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
