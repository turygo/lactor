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

const DEFAULT_PORT = 7890;

let backendPort = DEFAULT_PORT;
let paragraphs = [];
let currentParaIndex = 0;
let voice = "en-US-AriaNeural";
let currentLang = "en";
let userChangedVoice = false;

const player = new Player();
const highlight = new HighlightEngine();
let scheduler = null;
let log = null; // set in init()

const contentEl = document.getElementById("content");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");

// Port connection to background script (WebSocket proxy)
let bgPort = null;
let bgConnected = false;

// Buffers: paraIndex -> { audioChunks: [], wordEvents: [], done: bool }
const buffers = new Map();

// Pending speak requests: paraIndex -> { resolve }
const pendingRequests = new Map();

const controls = new Controls({
  onPlay: handlePlay,
  onPause: handlePause,
  onVoiceChange: (v) => {
    voice = v;
    userChangedVoice = true;
    saveVoicePref(currentLang, v, browser.storage.local);
  },
  onClose: () => {
    cleanup();
    window.parent.postMessage({ type: "lactor-close" }, "*");
  },
});

async function init() {
  let debug = false;
  try {
    debug = await isDebugMode();
  } catch (e) {
    console.error("[Lactor] isDebugMode failed:", e);
    debug = true; // fallback to enabled
  }
  const logger = new Logger(debug);
  log = logger.scope("reader");
  console.log("[Lactor] reader init, debug =", debug); // always log this one

  window.parent.postMessage({ type: "lactor-ready" }, "*");

  try {
    const result = await browser.storage.local.get("port");
    if (result.port) backendPort = result.port;
  } catch {}

  const params = new URLSearchParams(location.search);
  const tabId = parseInt(params.get("tabId"), 10);
  if (isNaN(tabId)) {
    showError("Invalid tab ID");
    return;
  }

  loadingEl.style.display = "block";
  try {
    const resp = await browser.runtime.sendMessage({ type: "getContent", tabId });
    if (!resp || !resp.data) {
      showError("No content available. Try clicking the Lactor icon again.");
      return;
    }

    const pipeline = createPipeline([sanitize, structure]);
    const ctx = pipeline.run(resp.data.content, { lang: resp.data.lang || "" });
    const segments = ctx.segments || [];
    paragraphs = segments.map((s) => s.text);

    if (paragraphs.length === 0) {
      showError("Could not extract readable text from this page.");
      return;
    }

    renderSegments(contentEl, segments);

    if (resp.data.title) {
      const h1 = document.createElement("h1");
      h1.textContent = resp.data.title;
      contentEl.prepend(h1);
    }

    loadingEl.style.display = "none";

    // Load user preferences and set current language
    currentLang = ctx.lang || "en";
    const prefs = await loadVoicePrefs(browser.storage.local);
    const userPref = prefs[currentLang] || "";

    // Cache-first voice loading: use cached voices immediately, refresh in background
    const cached = await loadCachedVoices(browser.storage.local);
    if (cached && cached.length > 0) {
      controls.populateVoices(cached);
      const resolved = resolveVoice(currentLang, cached, userPref);
      if (resolved) {
        voice = resolved;
        controls.setVoice(resolved);
      }
    }

    // Fetch fresh voices (updates UI and cache when done)
    const fresh = await controls.loadVoices(backendPort);
    if (fresh.length > 0) {
      cacheVoices(fresh, browser.storage.local);
      // Skip auto-selection if user manually changed voice during the fetch
      if (!userChangedVoice) {
        const resolved = resolveVoice(currentLang, fresh, userPref);
        if (resolved) {
          voice = resolved;
          controls.setVoice(resolved);
        }
      }
    } else if (!cached && controls.selectedVoice) {
      voice = controls.selectedVoice;
    }

    scheduler = new PrefetchScheduler(paragraphs, 3);
    connectToBg();
  } catch (err) {
    showError(`Failed to load content: ${err.message}`);
  }
}

function showError(msg) {
  loadingEl.style.display = "none";
  errorEl.textContent = msg;
  errorEl.style.display = "block";
}

// ── Port communication ──────────────────────────────────────────

function connectToBg() {
  bgPort = browser.runtime.connect({ name: "lactor-tts" });

  bgPort.onMessage.addListener((msg) => {
    if (msg.type === "connected") {
      bgConnected = true;
      log.log("background WS connected");
      return;
    }
    if (msg.type === "ws-error") {
      log.warn(`WS conn ${msg.conn} error: ${msg.message}`);
      bgConnected = false; // mark as disconnected so dispatch triggers reconnect
      return;
    }

    const paraIndex = parseParaIndex(msg.id);
    if (paraIndex === null) return;

    if (!buffers.has(paraIndex)) {
      buffers.set(paraIndex, { audioChunks: [], wordEvents: [], done: false });
    }
    const buf = buffers.get(paraIndex);

    if (msg.type === "audio") {
      buf.audioChunks.push(msg.data);
    } else if (msg.type === "word") {
      buf.wordEvents.push(msg);
    } else if (msg.type === "done") {
      buf.done = true;
      log.log(
        `para ${paraIndex} fetch done, chunks=${buf.audioChunks.length}, words=${buf.wordEvents.length}`
      );
      scheduler.onFetchComplete(paraIndex);
      resolvePending(paraIndex);
      tryPrefetch();
    } else if (msg.type === "error") {
      log.error(`TTS error para ${paraIndex}: ${msg.message}`);
      buf.done = true;
      resolvePending(paraIndex);
    }
  });

  bgPort.onDisconnect.addListener(() => {
    bgConnected = false;
    bgPort = null;
  });
  bgPort.postMessage({ action: "connect", port: backendPort });
}

function parseParaIndex(id) {
  if (!id || !id.startsWith("para-")) return null;
  const n = parseInt(id.slice(5), 10);
  return isNaN(n) ? null : n;
}

function resolvePending(paraIndex) {
  const pending = pendingRequests.get(paraIndex);
  if (pending) {
    pending.resolve();
    pendingRequests.delete(paraIndex);
  }
}

// ── Prefetch scheduling ─────────────────────────────────────────

function reconnectBg() {
  if (!bgPort) return;
  log.log("requesting background WS reconnect");
  if (scheduler) scheduler.resetConnections();
  bgPort.postMessage({ action: "connect", port: backendPort });
}

function dispatchFetch(fetch) {
  const paraId = `para-${fetch.index}`;
  log.log(
    `dispatch fetch: para ${fetch.index} on conn ${fetch.conn}, text=${fetch.text.length} chars`
  );
  buffers.set(fetch.index, { audioChunks: [], wordEvents: [], done: false });

  let retries = 0;
  const send = () => {
    if (bgPort && bgConnected) {
      bgPort.postMessage({
        action: "speak",
        conn: fetch.conn,
        id: paraId,
        text: fetch.text,
        voice,
      });
    } else if (bgPort) {
      retries++;
      if (retries === 1) {
        log.log(`dispatch fetch: connection lost, triggering reconnect`);
        reconnectBg();
      }
      if (retries > 50) {
        // 5 seconds max
        log.error(`dispatch fetch: gave up after ${retries} retries`);
        return;
      }
      setTimeout(send, 100);
    }
  };
  send();
}

/**
 * Ensure a specific paragraph is buffered and ready.
 * - If already done → resolves immediately
 * - If in-flight (dispatched by prefetcher) → waits for done
 * - If not dispatched yet → dispatches and waits
 */
function ensureBuffered(paraIndex) {
  if (buffers.has(paraIndex) && buffers.get(paraIndex).done) {
    log.log(`ensureBuffered: para ${paraIndex} already done`);
    return Promise.resolve();
  }

  // Not dispatched yet — dispatch it now
  if (!buffers.has(paraIndex)) {
    log.log(`ensureBuffered: para ${paraIndex} not dispatched, dispatching now`);
    const fetch = scheduler.getNextFetch();
    if (fetch) dispatchFetch(fetch);
  } else {
    log.log(`ensureBuffered: para ${paraIndex} in-flight, waiting for done`);
  }

  // Wait for done event (covers both in-flight and just-dispatched)
  return new Promise((resolve) => {
    if (buffers.has(paraIndex) && buffers.get(paraIndex).done) {
      resolve();
      return;
    }
    pendingRequests.set(paraIndex, { resolve });
  });
}

function tryPrefetch() {
  if (!scheduler) return;
  const remainingMs = getRemainingPlaybackMs();
  while (scheduler.shouldPrefetch(remainingMs)) {
    const next = scheduler.getNextFetch();
    if (!next) break;
    dispatchFetch(next);
  }
}

function getRemainingPlaybackMs() {
  if (!player.playing || !player._currentBuffer) return 0;
  const totalMs = player._currentBuffer.duration * 1000;
  return Math.max(0, totalMs - player.getCurrentTimeMs());
}

// ── Playback ────────────────────────────────────────────────────

async function handlePlay() {
  if (player.playing) return;

  // Reconnect if WS dropped during pause
  if (!bgConnected && bgPort) {
    log.log("play: reconnecting WS before resume");
    reconnectBg();
  }

  if (player._currentBuffer) {
    await player.resume();
    highlight.start(() => player.getCurrentTimeMs());
    return;
  }

  await playFromParagraph(currentParaIndex);
}

async function handlePause() {
  await player.pause();
  highlight.stop();
}

async function playFromParagraph(paraIndex) {
  if (paraIndex >= paragraphs.length) {
    log.log("all paragraphs finished");
    controls.setPlaying(false);
    return;
  }

  currentParaIndex = paraIndex;
  log.log(`playFromParagraph(${paraIndex}/${paragraphs.length - 1})`);

  // Mark paragraph as current in UI
  document.querySelectorAll("[data-para]").forEach((p) => p.classList.remove("current-para"));
  const paraEl = document.querySelector(`[data-para="${paraIndex}"]`);
  if (paraEl) paraEl.classList.add("current-para");

  // Ensure current paragraph is buffered (may already be in-flight from prefetcher)
  await ensureBuffered(paraIndex);

  // Trigger adaptive prefetch for upcoming paragraphs
  tryPrefetch();

  // Decode and play
  const buf = buffers.get(paraIndex);
  if (!buf || buf.audioChunks.length === 0) {
    log.warn(`para ${paraIndex} has no audio chunks, skipping`);
    await playFromParagraph(paraIndex + 1);
    return;
  }

  try {
    log.log(`para ${paraIndex} decoding ${buf.audioChunks.length} chunks...`);
    const audioBuffer = await player.decodeAudio(buf.audioChunks);
    log.log(`para ${paraIndex} decoded, duration=${audioBuffer.duration.toFixed(2)}s, playing`);

    highlight.loadParagraph(paraIndex);
    highlight.addWordEvents(buf.wordEvents);

    player.play(audioBuffer, async () => {
      log.log(`para ${paraIndex} playback ended, isPlaying=${controls.isPlaying}`);
      highlight.stop();
      if (paraEl) {
        paraEl.classList.remove("current-para");
        paraEl.classList.add("played");
      }
      buf.audioChunks = [];
      scheduler.onPlaybackComplete();

      tryPrefetch();

      if (controls.isPlaying) {
        await playFromParagraph(paraIndex + 1);
      }
    });

    highlight.start(() => player.getCurrentTimeMs());
  } catch (err) {
    log.error(`decode failed para ${paraIndex}:`, err);
    await playFromParagraph(paraIndex + 1);
  }
}

// ── Cleanup ─────────────────────────────────────────────────────

function cleanup() {
  player.destroy();
  highlight.reset();
  if (bgPort) {
    bgPort.postMessage({ action: "close" });
    bgPort.disconnect();
    bgPort = null;
  }
  buffers.clear();
  pendingRequests.clear();
}

window.addEventListener("beforeunload", cleanup);

init();
