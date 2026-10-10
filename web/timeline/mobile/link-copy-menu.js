    const linkCopyMenu = document.createElement("select");
    linkCopyMenu.className = "hub-native-menu-select is-ios-active";
    linkCopyMenu.setAttribute("aria-label", "Link actions");
    document.body.append(linkCopyMenu);
    let pendingLinkCopy = null;
    const cancelLinkCopy = () => {
      pendingLinkCopy?.reject(new DOMException("Cancelled", "AbortError"));
      pendingLinkCopy = null;
    };
    const wireLinkCopyMenu = (root) => {
      root.addEventListener("agent-link-menu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        cancelLinkCopy();
        const url = event.detail.url;
        linkCopyMenu.replaceChildren(new Option(url, "", true, true), new Option("Copy URL", "copy"));
        linkCopyMenu.options[0].disabled = true;
        const rect = event.target.getBoundingClientRect();
        let left = rect.left;
        let top = rect.top;
        let frame = (root.ownerDocument || root).defaultView.frameElement;
        while (frame) {
          const frameRect = frame.getBoundingClientRect();
          left += frameRect.left + frame.clientLeft;
          top += frameRect.top + frame.clientTop;
          frame = frame.ownerDocument.defaultView.frameElement;
        }
        linkCopyMenu.style.left = `${left}px`;
        linkCopyMenu.style.top = `${top}px`;
        linkCopyMenu.style.width = `${rect.width}px`;
        linkCopyMenu.style.height = `${rect.height}px`;
        const copy = { url };
        const content = new Promise((resolve, reject) => { copy.resolve = resolve; copy.reject = reject; });
        pendingLinkCopy = copy;
        try {
          copy.result = navigator.clipboard.write([new ClipboardItem({ "text/plain": content })])
            .then(() => null, (error) => error);
        } catch (error) {
          copy.result = Promise.resolve(error);
          content.catch(() => {});
        }
        openNativeSelect(linkCopyMenu);
      });
    };
    linkCopyMenu.addEventListener("change", async () => {
      if (!linkCopyMenu.value) { cancelLinkCopy(); return; }
      const copy = pendingLinkCopy;
      pendingLinkCopy = null;
      linkCopyMenu.value = "";
      copy.resolve(new Blob([copy.url], { type: "text/plain" }));
      const error = await copy.result;
      if (error) setError("Copy failed", error);
      else setStatus("Copied URL");
    });
    wireLinkCopyMenu(messagesEl);
    window.addEventListener("pagehide", cancelLinkCopy);
