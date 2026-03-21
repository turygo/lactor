/**
 * Controls: play/pause button, voice dropdown, close button.
 */
export class Controls {
  constructor({ onPlay, onPause, onVoiceChange, onClose }) {
    this._playBtn = document.getElementById("btn-play");
    this._voiceSelect = document.getElementById("voice-select");
    this._closeBtn = document.getElementById("btn-close");
    this._playing = false;

    this._onPlay = onPlay;
    this._onPause = onPause;

    this._playBtn.addEventListener("click", () => {
      if (this._playing) {
        this._playing = false;
        this._playBtn.textContent = "\u25B6"; // play triangle
        onPause();
      } else {
        this._playing = true;
        this._playBtn.textContent = "\u23F8"; // pause
        onPlay();
      }
    });

    this._voiceSelect.addEventListener("change", () => {
      onVoiceChange(this._voiceSelect.value);
    });

    this._closeBtn.addEventListener("click", () => {
      onClose();
    });
  }

  get selectedVoice() {
    return this._voiceSelect.value;
  }

  get isPlaying() {
    return this._playing;
  }

  setPlaying(playing) {
    this._playing = playing;
    this._playBtn.textContent = playing ? "\u23F8" : "\u25B6";
  }

  /**
   * Populate voice dropdown from backend /voices endpoint.
   * @param {number} port - backend port
   */
  async loadVoices(port) {
    try {
      const resp = await fetch(`http://localhost:${port}/voices`);
      if (!resp.ok) return;
      const voices = await resp.json();
      this._voiceSelect.innerHTML = "";
      for (const v of voices) {
        const opt = document.createElement("option");
        opt.value = v.name;
        opt.textContent = `${v.name} (${v.locale})`;
        this._voiceSelect.appendChild(opt);
      }
      // Default to first English voice
      const enVoice = voices.find((v) => v.locale.startsWith("en-"));
      if (enVoice) this._voiceSelect.value = enVoice.name;
    } catch (err) {
      console.error("Lactor: failed to load voices", err);
    }
  }
}
