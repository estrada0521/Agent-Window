    const MOBILE_HAND_KEY = "agent_window_mobile_hand";
    const applyStoredMobileHand = () => {
      if (localStorage.getItem(MOBILE_HAND_KEY) === "right") document.documentElement.dataset.hand = "right";
      else delete document.documentElement.dataset.hand;
    };
    applyStoredMobileHand();
    window.addEventListener("storage", (event) => {
      if (event.key === MOBILE_HAND_KEY) applyStoredMobileHand();
    });
