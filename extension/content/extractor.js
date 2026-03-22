(async () => {
  try {
    if (typeof Defuddle === "undefined") {
      console.error("Lactor: Defuddle not loaded");
      browser.runtime.sendMessage({ type: "extraction-failed" });
      return;
    }

    const result = new Defuddle(document).parse();
    if (!result || !result.content) {
      console.warn("Lactor: Defuddle returned empty content");
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
    console.error("Lactor: extraction error", err);
    browser.runtime.sendMessage({ type: "extraction-failed" });
  }
})();
