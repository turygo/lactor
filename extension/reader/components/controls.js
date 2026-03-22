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
   * Populate voice dropdown from backend /voices endpoint.
   * @param {{ httpUrl: function }} config - config object with httpUrl method
   * @param {{ skipUI?: boolean }} [opts] - skip UI rebuild (e.g. when user already changed voice)
   * @returns {Promise<Array<{name: string, locale: string}>>} Loaded voices, or [] on error
   */
  async loadVoices(config, opts) {
    try {
      const resp = await fetch(config.httpUrl("/voices"));
      if (!resp.ok) return [];
      const voices = await resp.json();
      if (!opts || !opts.skipUI) {
        this.populateVoices(voices);
      }
      return voices;
    } catch (err) {
      console.error("Lactor: failed to load voices", err);
      return [];
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
