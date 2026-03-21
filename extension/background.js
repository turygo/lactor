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
