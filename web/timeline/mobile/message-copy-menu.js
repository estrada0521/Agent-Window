    const messageCopyMenu = document.createElement("select");
    messageCopyMenu.className = "hub-native-menu-select is-ios-active";
    messageCopyMenu.setAttribute("aria-label", "Message actions");
    document.body.append(messageCopyMenu);
    let messageCopyPress = null;
    let pendingMessageCopy = null;
    const cancelMessageCopy = () => {
      pendingMessageCopy?.reject(new Error("Copy cancelled"));
      pendingMessageCopy = null;
    };
    messagesEl.addEventListener("touchstart", (event) => {
      const button = event.target.closest(".copy-btn");
      const touch = event.touches[0];
      messageCopyPress = button && event.touches.length === 1
        ? { button, x: touch.clientX, y: touch.clientY, started: performance.now() } : null;
    }, { passive: true });
    messagesEl.addEventListener("touchmove", (event) => {
      const touch = event.touches[0];
      if (messageCopyPress && (!touch || Math.hypot(touch.clientX - messageCopyPress.x, touch.clientY - messageCopyPress.y) > 10)) messageCopyPress = null;
    }, { passive: true });
    messagesEl.addEventListener("touchcancel", () => { messageCopyPress = null; }, { passive: true });
    messagesEl.addEventListener("contextmenu", (event) => {
      if (event.target.closest(".copy-btn")) event.preventDefault();
    });
    messagesEl.addEventListener("touchend", (event) => {
      const press = messageCopyPress;
      messageCopyPress = null;
      if (!press || performance.now() - press.started < 450) return;
      event.preventDefault();
      event.stopPropagation();
      const row = press.button.closest("article.message-row");
      const entry = displayEntriesForData(latestPayloadData).find((entry) => entry.context_hash === row.dataset.contextHash);
      const nativeAvailable = row.dataset.sender !== "user" && !!entry.native_log_path && entry.native_log_offset != null;
      messageCopyMenu.innerHTML = '<option value="" disabled selected>Message</option><option value="copyMessage">Copy</option><option value="copyLogEntry">Copy Log Entry</option>'
        + (nativeAvailable ? '<option value="copyNativeLogEntry">Copy Native Log Entry</option>' : "");
      const rect = press.button.getBoundingClientRect();
      messageCopyMenu.style.left = `${rect.left}px`;
      messageCopyMenu.style.top = `${rect.top}px`;
      messageCopyMenu.style.width = `${rect.width}px`;
      messageCopyMenu.style.height = `${rect.height}px`;
      cancelMessageCopy();
      const copy = { contextHash: row.dataset.contextHash };
      const content = new Promise((resolve, reject) => { copy.resolve = resolve; copy.reject = reject; });
      pendingMessageCopy = copy;
      try {
        copy.result = navigator.clipboard.write([new ClipboardItem({ "text/plain": content })])
          .then(() => null, (error) => error);
      } catch (error) {
        copy.result = Promise.resolve(error);
        content.catch(() => {});
      }
      openNativeSelect(messageCopyMenu);
    }, { passive: false });
    messageCopyMenu.addEventListener("change", async () => {
      const action = messageCopyMenu.value;
      messageCopyMenu.value = "";
      if (!action) { cancelMessageCopy(); return; }
      const copy = pendingMessageCopy;
      pendingMessageCopy = null;
      try {
        const text = await messageCopyText(copy.contextHash, action);
        copy.resolve(new Blob([text], { type: "text/plain" }));
        const error = await copy.result;
        if (error) throw error;
        setStatus(action === "copyMessage" ? "Copied" : action === "copyLogEntry" ? "Copied log entry" : "Copied native log entry");
      } catch (error) {
        copy.reject(error);
        setError(action === "copyNativeLogEntry" ? "Native log unavailable" : "Copy failed", error);
      }
    });
    window.addEventListener("pagehide", cancelMessageCopy);
