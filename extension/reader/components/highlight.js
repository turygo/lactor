/**
 * HighlightEngine: maps charOffset from word events to rendered spans,
 * drives rAF-based highlighting loop, and auto-scrolls.
 */
export class HighlightEngine {
  constructor() {
    this._spans = []; // sorted by charOffset
    this._offsets = []; // parallel array of charOffset values for binary search
    this._wordEvents = []; // sorted word events for current paragraph
    this._wordIndex = 0;
    this._activeSpan = null;
    this._rafId = null;
    this._getTime = null; // function returning current playback time in ms
    this._paraStartTime = 0;
  }

  /**
   * Prepare for a new paragraph. Call before playback starts.
   * @param {number} paraIndex - paragraph index (data-para attribute)
   */
  loadParagraph(paraIndex) {
    this.stop();
    const paraEl = document.querySelector(`p[data-para="${paraIndex}"]`);
    if (!paraEl) return;

    this._spans = Array.from(paraEl.querySelectorAll("span[data-char-offset]"));
    this._offsets = this._spans.map((s) => parseInt(s.dataset.charOffset, 10));
    this._wordEvents = [];
    this._wordIndex = 0;
    this._clearActive();
  }

  /**
   * Add word events received from the backend.
   */
  addWordEvents(events) {
    this._wordEvents.push(...events);
    // Keep sorted by offset (should already be, but defensive)
    this._wordEvents.sort((a, b) => a.offset - b.offset);
  }

  /**
   * Start the rAF highlight loop.
   * @param {Function} getTimeMs - returns current audio playback time in ms
   */
  start(getTimeMs) {
    this._getTime = getTimeMs;
    this._wordIndex = 0;
    this._tick();
  }

  stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _tick() {
    if (!this._getTime) return;
    const currentMs = this._getTime();

    while (
      this._wordIndex < this._wordEvents.length &&
      this._wordEvents[this._wordIndex].offset <= currentMs
    ) {
      const event = this._wordEvents[this._wordIndex];
      this._highlightByCharOffset(event.charOffset);
      this._wordIndex++;
    }

    this._rafId = requestAnimationFrame(() => this._tick());
  }

  _highlightByCharOffset(charOffset) {
    // Binary search for the span whose charOffset range contains the target
    const idx = this._binarySearch(charOffset);
    if (idx < 0) return;

    const span = this._spans[idx];
    if (span === this._activeSpan) return;

    this._clearActive();
    span.classList.add("active");
    this._activeSpan = span;

    // Auto-scroll if span is not in viewport
    const rect = span.getBoundingClientRect();
    if (rect.top < 80 || rect.bottom > window.innerHeight - 40) {
      span.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /**
   * Binary search: find the span whose charOffset is <= target and is closest.
   */
  _binarySearch(target) {
    const offsets = this._offsets;
    let lo = 0,
      hi = offsets.length - 1,
      result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid] <= target) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }

  _clearActive() {
    if (this._activeSpan) {
      this._activeSpan.classList.remove("active");
      this._activeSpan = null;
    }
  }

  reset() {
    this.stop();
    this._clearActive();
    this._wordEvents = [];
    this._wordIndex = 0;
    this._spans = [];
    this._offsets = [];
  }
}
