/**
 * Tracks TTS generation speed (ms per character) using a sliding window.
 */
export class MetricsTracker {
  constructor(windowSize = 5, defaultRate = 10) {
    this._samples = [];
    this._windowSize = windowSize;
    this._defaultRate = defaultRate;
  }

  getRate() {
    if (this._samples.length === 0) return this._defaultRate;
    const sum = this._samples.reduce((a, b) => a + b, 0);
    return sum / this._samples.length;
  }

  record(charCount, genTimeMs) {
    this._samples.push(genTimeMs / charCount);
    if (this._samples.length > this._windowSize) {
      this._samples.shift();
    }
  }

  estimateGenTime(charCount) {
    return charCount * this.getRate();
  }
}

/**
 * Adaptive prefetch scheduler with per-connection busy tracking.
 *
 * Each of the 2 WebSocket connections can only handle ONE speak at a time.
 * The scheduler tracks which connections are busy and only dispatches
 * when a connection is free.
 */
export class PrefetchScheduler {
  constructor(paragraphs, maxBuffer = 3) {
    this._paragraphs = paragraphs;
    this._maxBuffer = maxBuffer;
    this._nextFetchIndex = 0;
    this._bufferedCount = 0;
    this._fetchStartTimes = new Map();
    this.metrics = new MetricsTracker();

    // Per-connection busy tracking: connBusy[i] = paraIndex or null
    this._connBusy = [null, null];
  }

  /** Number of in-flight (dispatched but not complete) fetches. */
  get _inFlightCount() {
    return (this._connBusy[0] !== null ? 1 : 0) + (this._connBusy[1] !== null ? 1 : 0);
  }

  /** Find a free connection. Returns 0 or 1, or -1 if both busy. */
  _freeConn() {
    if (this._connBusy[0] === null) return 0;
    if (this._connBusy[1] === null) return 1;
    return -1;
  }

  shouldPrefetch(remainingPlaybackMs) {
    if (this._nextFetchIndex >= this._paragraphs.length) return false;
    if (this._freeConn() === -1) return false;
    if (this._inFlightCount + this._bufferedCount >= this._maxBuffer) return false;
    if (this._inFlightCount + this._bufferedCount === 0) return true;

    const nextText = this._paragraphs[this._nextFetchIndex];
    const estGenTime = this.metrics.estimateGenTime(nextText.length);
    return estGenTime > remainingPlaybackMs * 0.8;
  }

  getNextFetch() {
    if (this._nextFetchIndex >= this._paragraphs.length) return null;

    const conn = this._freeConn();
    if (conn === -1) return null;

    const index = this._nextFetchIndex;
    const text = this._paragraphs[index];

    this._connBusy[conn] = index;
    this._fetchStartTimes.set(index, Date.now());
    this._nextFetchIndex++;

    return { conn, index, text };
  }

  onFetchComplete(paraIndex) {
    // Free the connection
    if (this._connBusy[0] === paraIndex) this._connBusy[0] = null;
    else if (this._connBusy[1] === paraIndex) this._connBusy[1] = null;

    const startTime = this._fetchStartTimes.get(paraIndex);
    if (startTime !== undefined) {
      const genTime = Date.now() - startTime;
      const charCount = this._paragraphs[paraIndex].length;
      this.metrics.record(charCount, genTime);
      this._fetchStartTimes.delete(paraIndex);
    }
    this._bufferedCount++;
  }

  onPlaybackComplete() {
    this._bufferedCount = Math.max(0, this._bufferedCount - 1);
  }
}
