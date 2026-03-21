const contentStore = new Map();
const CONTENT_TTL_MS = 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [tabId, entry] of contentStore) {
    if (now - entry.timestamp > CONTENT_TTL_MS) contentStore.delete(tabId);
  }
}, 10_000);

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "content") {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      contentStore.set(tabId, { data: msg.data, timestamp: Date.now() });
      browser.scripting
        .executeScript({
          target: { tabId },
          func: (tid) => {
            window.__lactorTabId = tid;
          },
          args: [tabId],
        })
        .then(() => {
          browser.scripting.executeScript({ target: { tabId }, files: ["content/overlay.js"] });
        });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "getContent") {
    const entry = contentStore.get(msg.tabId);
    if (entry) {
      contentStore.delete(msg.tabId);
      sendResponse({ data: entry.data });
    } else {
      sendResponse({ data: null, error: "No content available" });
    }
    return false;
  }

  if (msg.type === "fallback-to-tab") {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      browser.tabs.update(tabId, {
        url: browser.runtime.getURL("reader/reader.html") + `?tabId=${tabId}`,
      });
    }
    return false;
  }

  if (msg.type === "extraction-failed") {
    console.warn("Lactor: extraction failed on tab", sender.tab?.id);
    return false;
  }
});

browser.action.onClicked.addListener(async (tab) => {
  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/defuddle.min.js", "content/extractor.js"],
    });
  } catch (err) {
    console.error("Failed to inject content scripts:", err);
  }
});

// --- WebSocket proxy via Port API ---

const MAX_RECONNECT = 3;

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "lactor-tts") return;

  const wsConns = [null, null]; // dual WebSocket connections
  let wsUrl = null;
  let reconnectCounts = [0, 0];

  function createWS(connIndex) {
    if (!wsUrl) return;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // Check if both connections are ready
      if (wsConns[0]?.readyState === WebSocket.OPEN && wsConns[1]?.readyState === WebSocket.OPEN) {
        try {
          port.postMessage({ type: "connected" });
        } catch {}
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        msg.conn = connIndex;
        port.postMessage(msg);
      } catch {}
    };

    ws.onclose = () => {
      if (reconnectCounts[connIndex] < MAX_RECONNECT && wsUrl) {
        reconnectCounts[connIndex]++;
        setTimeout(() => {
          wsConns[connIndex] = createWS(connIndex);
        }, 1000);
      } else {
        try {
          port.postMessage({ type: "ws-error", conn: connIndex, message: "Connection closed" });
        } catch {}
      }
    };

    ws.onerror = () => {
      try {
        port.postMessage({ type: "ws-error", conn: connIndex, message: "Connection error" });
      } catch {}
    };

    wsConns[connIndex] = ws;
    return ws;
  }

  port.onMessage.addListener((msg) => {
    if (msg.action === "connect") {
      wsUrl = `ws://127.0.0.1:${msg.port}/tts`;
      reconnectCounts = [0, 0];
      createWS(0);
      createWS(1);
    } else if (msg.action === "speak" || msg.action === "cancel") {
      const ws = wsConns[msg.conn];
      if (ws && ws.readyState === WebSocket.OPEN) {
        const payload = { ...msg };
        delete payload.conn;
        ws.send(JSON.stringify(payload));
      }
    } else if (msg.action === "close") {
      closeAll();
    }
  });

  function closeAll() {
    wsUrl = null; // prevent reconnects
    for (let i = 0; i < 2; i++) {
      if (wsConns[i] && wsConns[i].readyState <= WebSocket.OPEN) {
        wsConns[i].close();
      }
      wsConns[i] = null;
    }
  }

  port.onDisconnect.addListener(() => {
    closeAll();
  });
});
