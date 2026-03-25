/**
 * createReaderUI — encapsulates all DOM operations for the reader view.
 *
 * Reader-core calls these methods instead of touching DOM directly.
 * Tests can mock this entire interface without JSDOM.
 *
 * @param {object} deps
 * @param {HTMLElement} deps.contentEl — article container
 * @param {HTMLElement} deps.loadingEl — loading indicator
 * @param {HTMLElement} deps.errorEl — error display
 * @param {Document} deps.document — for createElement / querySelector
 * @param {Function} deps.renderSegments — (contentEl, segments, url) => void
 */
export function createReaderUI({ contentEl, loadingEl, errorEl, document, renderSegments }) {
  function showLoading() {
    loadingEl.style.display = "block";
  }

  function hideLoading() {
    loadingEl.style.display = "none";
  }

  function showError(msg) {
    loadingEl.style.display = "none";
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  }

  function renderContent(segments, url) {
    renderSegments(contentEl, segments, url);
  }

  function setTitle(title) {
    if (!title) return;
    const h1 = document.createElement("h1");
    h1.textContent = title;
    contentEl.prepend(h1);
  }

  function markCurrent(paraIndex) {
    document.querySelectorAll("[data-para].current-para").forEach((p) => {
      p.classList.remove("current-para");
    });
    const el = document.querySelector(`[data-para="${paraIndex}"]`);
    if (el) el.classList.add("current-para");
  }

  function markPlayed(paraIndex) {
    const el = document.querySelector(`[data-para="${paraIndex}"]`);
    if (!el) return;
    el.classList.remove("current-para");
    el.classList.add("played");
  }

  return { showLoading, hideLoading, showError, renderContent, setTitle, markCurrent, markPlayed };
}
