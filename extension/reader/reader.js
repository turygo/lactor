import { createReader } from "./reader-core.js";
import { HighlightEngine } from "./components/highlight.js";
import { Player } from "./components/player.js";
import { Controls } from "./components/controls.js";
import { PrefetchScheduler } from "./components/scheduler.js";
import { Logger, isDebugMode } from "./components/logger.js";
import { createPipeline } from "./components/pipeline/index.js";
import { sanitize } from "./components/pipeline/sanitize.js";
import { structure } from "./components/pipeline/structure.js";
import { renderSegments } from "./components/render-segments.js";
import { resolveVoice } from "./components/resolve-voice.js";
import { loadCachedVoices, cacheVoices } from "./components/voice-cache.js";
import { loadVoicePrefs, saveVoicePref } from "./components/voice-prefs.js";
import { loadConfig } from "../config.js";

const reader = createReader({
  dom: {
    contentEl: document.getElementById("content"),
    loadingEl: document.getElementById("loading"),
    errorEl: document.getElementById("error"),
    document,
    window,
    location,
  },
  browser: {
    runtime: browser.runtime,
    storage: { local: browser.storage.local },
  },
  components: {
    createPlayer: () => new Player(),
    createHighlight: () => new HighlightEngine(),
    createControls: (cbs, opts) => new Controls(cbs, opts),
    createScheduler: (paras, cap) => new PrefetchScheduler(paras, cap),
  },
  functions: {
    loadConfig,
    createPipeline,
    sanitize,
    structure,
    renderSegments,
    resolveVoice,
    loadCachedVoices,
    cacheVoices,
    loadVoicePrefs,
    saveVoicePref,
    isDebugMode,
    Logger,
  },
});

window.addEventListener("beforeunload", () => reader.cleanup());

reader.init();
