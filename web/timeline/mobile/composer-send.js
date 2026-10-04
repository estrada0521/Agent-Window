    const updateSendBtnVisibility = () => {
      const label = isTerminalMode() ? "Type into Terminal" : "Send";
      sendBtn.setAttribute("aria-label", label);
      sendBtn.title = label;
    };
