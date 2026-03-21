/**
 * Tracks TTS generation speed (ms per character) using a sliding window.
 */
export class MetricsTracker {
  constructor(windowSize = 5, defaultRate = 10) {
    this._samples = [];
    this._windowSize = windowSize;
    this._defaultRate = defaultRate;
  }

  /** Current estimated generation rate in ms/char. */
  getRate() {
    if (this._samples.length === 0) return this._defaultRate;
    const sum = this._samples.reduce((a, b) => a + b, 0);
    return sum / this._samples.length;
  }

  /** Record a completed generation: charCount characters took genTimeMs. */
  record(charCount, genTimeMs) {
    this._samples.push(genTimeMs / charCount);
    if (this._samples.length > this._windowSize) {
      this._samples.shift();
    }
  }

  /** Estimate generation time in ms for a text of given character count. */
  estimateGenTime(charCount) {
    return charCount * this.getRate();
  }
}

/**
 * Adaptive prefetch scheduler.
 * Decides when to fetch the next paragraph based on generation speed metrics
 * and remaining playback time. Alternates between two connections.
 */
export class PrefetchScheduler {
  /**
   * @param {string[]} paragraphs - array of paragraph texts
   * @param {number} maxBuffer - max paragraphs to buffer ahead (cap)
   */
  constructor(paragraphs, maxBuffer = 3) {
    this._paragraphs = paragraphs;
    this._maxBuffer = maxBuffer;
    this._nextFetchIndex = 0;
    this._nextConn = 0;
    this._bufferedCount = 0;
    this._fetchStartTimes = new Map();
    this.metrics = new MetricsTracker();
  }

  /**
   * Should we prefetch now?
   * @param {number} remainingPlaybackMs - ms remaining in current paragraph playback
   * @returns {boolean}
   */
  shouldPrefetch(remainingPlaybackMs) {
    // Nothing left to fetch
    if (this._nextFetchIndex >= this._paragraphs.length) return false;

    // Buffer full
    if (this._bufferedCount >= this._maxBuffer) return false;

    // Cold start: always prefetch when buffer is empty
    if (this._bufferedCount === 0) return true;

    // Adaptive: prefetch if estimated gen time > 80% of remaining playback
    const nextText = this._paragraphs[this._nextFetchIndex];
    const estGenTime = this.metrics.estimateGenTime(nextText.length);
    return estGenTime > remainingPlaybackMs * 0.8;
  }

  /**
   * Get the next paragraph to fetch. Returns null if all dispatched.
   * @returns {{ conn: number, index: number, text: string } | null}
   */
  getNextFetch() {
    if (this._nextFetchIndex >= this._paragraphs.length) return null;

    const index = this._nextFetchIndex;
    const conn = this._nextConn;
    const text = this._paragraphs[index];

    this._fetchStartTimes.set(index, Date.now());
    this._nextFetchIndex++;
    this._nextConn = 1 - this._nextConn; // alternate 0 ↔ 1

    return { conn, index, text };
  }

  /**
   * Called when a paragraph fetch completes (done event received).
   * Records generation timing metrics.
   * @param {number} paraIndex
   */
  onFetchComplete(paraIndex) {
    const startTime = this._fetchStartTimes.get(paraIndex);
    if (startTime !== undefined) {
      const genTime = Date.now() - startTime;
      const charCount = this._paragraphs[paraIndex].length;
      this.metrics.record(charCount, genTime);
      this._fetchStartTimes.delete(paraIndex);
    }
    this._bufferedCount++;
  }

  /**
   * Called when a paragraph finishes playing. Decrements buffer count.
   */
  onPlaybackComplete() {
    this._bufferedCount = Math.max(0, this._bufferedCount - 1);
  }
}
