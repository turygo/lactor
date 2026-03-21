/**
 * Player: Web Audio API playback with pause/resume.
 * Assembles base64 audio chunks into a single AudioBuffer per paragraph.
 */
export class Player {
  constructor() {
    this._ctx = new AudioContext();
    this._source = null;
    this._startTime = 0; // AudioContext time when playback started
    this._pauseOffset = 0; // how far into the buffer we were when paused
    this._currentBuffer = null;
    this._playing = false;
    this._onEndedCallback = null;
  }

  get context() {
    return this._ctx;
  }

  get playing() {
    return this._playing;
  }

  /**
   * Get current playback time in milliseconds.
   */
  getCurrentTimeMs() {
    if (!this._playing) return this._pauseOffset * 1000;
    return (this._ctx.currentTime - this._startTime + this._pauseOffset) * 1000;
  }

  /**
   * Decode base64 audio chunks into a single AudioBuffer.
   * @param {string[]} base64Chunks - array of base64-encoded audio chunks
   * @returns {Promise<AudioBuffer>}
   */
  async decodeAudio(base64Chunks) {
    // Decode base64 to binary
    const binaryParts = base64Chunks.map((b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    });

    // Concatenate all chunks
    const totalLength = binaryParts.reduce((sum, part) => sum + part.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of binaryParts) {
      combined.set(part, offset);
      offset += part.length;
    }

    // Ensure AudioContext is running
    if (this._ctx.state === "suspended") {
      await this._ctx.resume();
    }

    return await this._ctx.decodeAudioData(combined.buffer);
  }

  /**
   * Play an AudioBuffer from the beginning.
   * @param {AudioBuffer} buffer
   * @param {Function} [onEnded] - callback when playback ends naturally
   */
  play(buffer, onEnded) {
    this.stopCurrent();
    this._currentBuffer = buffer;
    this._pauseOffset = 0;
    this._onEndedCallback = onEnded || null;
    this._startPlayback(0);
  }

  _startPlayback(offsetSec) {
    const source = this._ctx.createBufferSource();
    source.buffer = this._currentBuffer;
    source.connect(this._ctx.destination);
    source.onended = () => {
      if (this._playing && this._source === source) {
        this._playing = false;
        this._source = null;
        if (this._onEndedCallback) this._onEndedCallback();
      }
    };
    source.start(0, offsetSec);
    this._source = source;
    this._startTime = this._ctx.currentTime;
    this._pauseOffset = offsetSec;
    this._playing = true;
  }

  async pause() {
    if (!this._playing) return;
    this._pauseOffset = this._ctx.currentTime - this._startTime + this._pauseOffset;
    await this._ctx.suspend();
    this._playing = false;
    if (this._source) {
      this._source.onended = null;
      this._source.stop();
      this._source = null;
    }
  }

  async resume() {
    if (this._playing || !this._currentBuffer) return;
    await this._ctx.resume();
    this._startPlayback(this._pauseOffset);
  }

  stopCurrent() {
    if (this._source) {
      this._source.onended = null;
      try {
        this._source.stop();
      } catch {}
      this._source = null;
    }
    this._playing = false;
    this._pauseOffset = 0;
    this._currentBuffer = null;
  }

  async destroy() {
    this.stopCurrent();
    if (this._ctx.state !== "closed") {
      await this._ctx.close();
    }
  }
}
