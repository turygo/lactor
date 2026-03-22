(async () => {
  const _log = {
    error: (...a) => console.error("[Lactor:extractor]", ...a),
    warn: (...a) => console.warn("[Lactor:extractor]", ...a),
  };

  try {
    if (typeof Defuddle === "undefined") {
      _log.error("Defuddle not loaded");
      browser.runtime.sendMessage({ type: "extraction-failed" });
      return;
    }

    const result = new Defuddle(document).parse();
    if (!result || !result.content) {
      _log.warn("Defuddle returned empty content");
      browser.runtime.sendMessage({ type: "extraction-failed" });
      return;
    }

    browser.runtime.sendMessage({
      type: "content",
      data: {
        title: result.title || document.title,
        content: result.content,
        url: location.href,
        lang: document.documentElement.lang || "",
      },
    });
  } catch (err) {
    _log.error("extraction error", err);
    browser.runtime.sendMessage({ type: "extraction-failed" });
  }
})();
