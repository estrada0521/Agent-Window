    {
      let press = null;
      let suppressClick = false;
      const sendButtonParent = sendBtn.parentElement;
      const restoreSendButton = () => {
        if (!document.body.classList.contains("composer-voice-open")) return;
        sendButtonParent.appendChild(sendBtn);
        sendBtn.removeAttribute("form");
        document.body.classList.remove("composer-voice-open");
      };
      const cancelPress = () => {
        if (press) clearTimeout(press.timer);
        press = null;
      };
      document.addEventListener("pointerdown", () => { suppressClick = false; }, true);
      composerFabBtn?.addEventListener("touchstart", (event) => {
        if (event.touches.length === 1 && canCompose()) event.preventDefault();
      }, { passive: false });
      composerFabBtn?.addEventListener("pointerdown", (event) => {
        cancelPress();
        if (event.button !== 0 || !event.isPrimary || !canCompose()) return;
        event.preventDefault();
        press = { x: event.clientX, y: event.clientY };
        press.timer = setTimeout(() => {
          press = null;
          if (!canCompose()) return;
          suppressClick = true;
          sendBtn.setAttribute("form", composerForm.id);
          document.body.appendChild(sendBtn);
          document.body.classList.add("composer-voice-open");
          openComposerOverlay();
          updateSendBtnVisibility();
          if (sendBtn.classList.contains("is-mic")) sendBtn.click();
          else setStatus(speechAvailable ? "Clear draft to use voice input" : "Voice input unavailable");
        }, 350);
      });
      document.addEventListener("pointermove", (event) => {
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) cancelPress();
      });
      document.addEventListener("pointerup", (event) => {
        const tapped = !!press && event.pointerType === "touch";
        cancelPress();
        if (tapped) openComposerOverlay({ immediateFocus: canCompose() });
      }, true);
      document.addEventListener("pointercancel", cancelPress, true);
      composerFabBtn?.addEventListener("contextmenu", (event) => event.preventDefault());
      document.addEventListener("click", (event) => {
        if (!suppressClick || !event.isTrusted) return;
        suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      document.addEventListener("composer-overlay-close-start", cancelPress);
      document.addEventListener("composer-overlay-close-start", restoreSendButton);
      messageInput.addEventListener("focus", () => {
        restoreSendButton();
        autoResizeTextarea();
      });
      window.addEventListener("pagehide", cancelPress);
    }
