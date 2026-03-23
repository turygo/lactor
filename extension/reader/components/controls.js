/**
 * Controls: play/pause button, voice dropdown, close button.
 */
export class Controls {
  constructor({ onPlay, onPause, onVoiceChange, onClose }, { log } = {}) {
    this._log = log || { error() {} };
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
   * Populate voice dropdown from a voice array (e.g. from cache).
   * @param {Array<{name: string, locale: string}>} voices
   */
  populateVoices(voices) {
    this._voiceSelect.innerHTML = "";
    for (const v of voices) {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.locale})`;
      this._voiceSelect.appendChild(opt);
    }
  }

  /**
   * Set the selected voice in the dropdown programmatically.
   * @param {string} name - Voice name to select
   */
  setVoice(name) {
    this._voiceSelect.value = name;
  }
}
