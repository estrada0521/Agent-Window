    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    const speechAvailable = !!SpeechRecognitionClass && window.isSecureContext;
    let speechRecognition = null;
    let speechStopReason = "";
    let spokenText = "";
    const updateSendBtnVisibility = () => {
      if (!sendBtn) return;
      const hasContent = messageInput.value.trim().length > 0 || pendingAttachments.length > 0;
      const listening = !!speechRecognition;
      const microphone = speechAvailable && sessionActive && !isTerminalMode() && !hasContent;
      sendBtn.classList.toggle("is-mic", microphone && !listening);
      sendBtn.classList.toggle("is-listening", listening);
      sendBtn.type = microphone || listening ? "button" : "submit";
      const label = listening ? "Stop listening" : microphone ? "Dictate" : isTerminalMode() ? "Type into Terminal" : "Send";
      sendBtn.setAttribute("aria-label", label);
      sendBtn.title = label;
      if (!isMobileComposer) sendBtn.classList.toggle("visible", !!sessionActive && (hasContent || microphone || listening));
    };
