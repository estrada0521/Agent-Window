    const stopSpeechRecognition = (reason) => {
      if (!speechRecognition || speechStopReason) return;
      speechStopReason = reason;
      speechRecognition.stop();
    };
    sendBtn?.addEventListener("click", () => {
      clearSendPressed();
      if (speechRecognition) {
        stopSpeechRecognition("manual");
        return;
      }
      if (!sendBtn.classList.contains("is-mic")) return;
      const recognition = new SpeechRecognitionClass();
      recognition.lang = navigator.language;
      recognition.continuous = false;
      recognition.interimResults = true;
      const previousPlaceholder = messageInput.placeholder;
      spokenText = "";
      let interimText = "";
      speechStopReason = "";
      speechRecognition = recognition;
      messageInput.readOnly = true;
      messageInput.placeholder = "Starting voice input…";
      const finish = (text) => {
        speechRecognition = null;
        speechStopReason = "";
        messageInput.readOnly = false;
        messageInput.placeholder = previousPlaceholder;
        messageInput.classList.remove("is-speech-interim");
        messageInput.value = text;
        messageInput.dispatchEvent(new Event("input", { bubbles: true }));
        updateSendBtnVisibility();
      };
      recognition.onaudiostart = () => {
        if (speechRecognition === recognition) messageInput.placeholder = "Listening…";
      };
      recognition.onspeechstart = () => {
        if (speechRecognition === recognition) messageInput.placeholder = "Hearing you…";
      };
      recognition.onspeechend = () => {
        if (speechRecognition === recognition) stopSpeechRecognition("speech-end");
      };
      recognition.onresult = (event) => {
        if (speechRecognition !== recognition) return;
        const results = Array.from(event.results);
        spokenText = results.filter((result) => result.isFinal)
          .map((result) => result[0]?.transcript || "").join(" ").trim();
        interimText = results.filter((result) => !result.isFinal)
          .map((result) => result[0]?.transcript || "").join(" ").trim();
        messageInput.value = [spokenText, interimText].filter(Boolean).join(" ");
        messageInput.classList.toggle("is-speech-interim", !!interimText);
        autoResizeTextarea();
        if (spokenText && !interimText) stopSpeechRecognition("final");
      };
      recognition.onerror = (event) => {
        if (speechRecognition !== recognition) return;
        const stopReason = speechStopReason;
        finish(stopReason ? spokenText || interimText : "");
        spokenText = "";
        if (stopReason === "manual" || stopReason === "final") return;
        const reason = event.message || event.error;
        const status = /Siri and Dictation are disabled/i.test(reason)
          ? "Turn on Siri for voice input"
          : event.error === "no-speech" ? "No speech heard"
          : event.error === "not-allowed" ? "Allow voice input in System Settings"
          : event.error === "audio-capture" ? "Microphone unavailable"
          : event.error === "network" ? "Voice input connection failed"
          : event.error === "aborted" ? "Voice input interrupted"
          : `Voice input: ${reason}`;
        setStatus(status);
      };
      recognition.onend = () => {
        if (speechRecognition !== recognition) return;
        finish(spokenText || interimText);
      };
      setStatus("");
      updateSendBtnVisibility();
      try {
        recognition.start();
      } catch (error) {
        finish("");
        setStatus(`Voice input: ${error.message}`);
      }
    });
    document.addEventListener("composer-overlay-close-start", () => stopSpeechRecognition("manual"));
