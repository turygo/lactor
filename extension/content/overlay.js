(function () {
  const _log = {
    warn: (...a) => console.warn("[Lactor:overlay]", ...a),
    error: (...a) => console.error("[Lactor:overlay]", ...a),
  };

  const EXISTING = document.getElementById("lactor-overlay");
  if (EXISTING) {
    EXISTING.remove();
    return;
  }

  const tabId = window.__lactorTabId;
  if (tabId == null) {
    _log.error("no tabId set");
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.id = "lactor-overlay";
  iframe.src = browser.runtime.getURL("reader/reader.html") + `?tabId=${tabId}`;
  iframe.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    z-index: 2147483647; border: none; opacity: 0;
    transition: opacity 0.3s ease;
  `;
  document.documentElement.appendChild(iframe);

  requestAnimationFrame(() => {
    iframe.style.opacity = "1";
  });

  let handshakeReceived = false;

  // Listen for ready handshake and close message
  function onMessage(event) {
    if (event.source !== iframe.contentWindow) return;
    if (!event.data || typeof event.data !== "object") return;

    if (event.data.type === "lactor-ready") {
      handshakeReceived = true;
    }

    if (event.data.type === "lactor-close") {
      closeOverlay();
    }
  }

  window.addEventListener("message", onMessage);

  // CSP fallback: if no handshake within 2s, fall back to tab navigation
  const handshakeTimeout = setTimeout(() => {
    if (!handshakeReceived) {
      _log.warn("iframe handshake timeout, falling back to tab");
      iframe.remove();
      window.removeEventListener("message", onMessage);
      browser.runtime.sendMessage({ type: "fallback-to-tab" });
    }
  }, 2000);

  iframe.addEventListener("error", () => {
    clearTimeout(handshakeTimeout);
    iframe.remove();
    window.removeEventListener("message", onMessage);
    browser.runtime.sendMessage({ type: "fallback-to-tab" });
  });

  function closeOverlay() {
    clearTimeout(handshakeTimeout);
    iframe.style.opacity = "0";
    iframe.addEventListener(
      "transitionend",
      () => {
        iframe.remove();
        window.removeEventListener("message", onMessage);
      },
      { once: true }
    );
  }
})();
