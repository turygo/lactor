import { splitIntoParagraphs, renderParagraphs } from "./components/normalizer.js";
import { HighlightEngine } from "./components/highlight.js";
import { Player } from "./components/player.js";
import { Controls } from "./components/controls.js";
import { PrefetchScheduler } from "./components/scheduler.js";

const DEFAULT_PORT = 7890;

let backendPort = DEFAULT_PORT;
let paragraphs = [];
let currentParaIndex = 0;
let voice = "en-US-AriaNeural";

const player = new Player();
const highlight = new HighlightEngine();
let scheduler = null;

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
  },
  onClose: () => {
    cleanup();
    window.parent.postMessage({ type: "lactor-close" }, "*");
  },
});

async function init() {
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

    paragraphs = splitIntoParagraphs(resp.data.content);
    if (paragraphs.length === 0) {
      showError("Could not extract readable text from this page.");
      return;
    }

    if (resp.data.title) {
      const h1 = document.createElement("h1");
      h1.textContent = resp.data.title;
      contentEl.appendChild(h1);
    }

    renderParagraphs(contentEl, paragraphs);
    loadingEl.style.display = "none";

    await controls.loadVoices(backendPort);
    if (controls.selectedVoice) voice = controls.selectedVoice;

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
      return;
    }
    if (msg.type === "ws-error") {
      console.warn(`Lactor: WS conn ${msg.conn} error: ${msg.message}`);
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
      scheduler.onFetchComplete(paraIndex);
      resolvePending(paraIndex);
      tryPrefetch(); // check if we should fetch more
    } else if (msg.type === "error") {
      console.error(`Lactor: TTS error for para ${paraIndex}: ${msg.message}`);
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

function dispatchFetch(fetch) {
  const paraId = `para-${fetch.index}`;
  buffers.set(fetch.index, { audioChunks: [], wordEvents: [], done: false });

  const send = () => {
    if (bgPort && bgConnected) {
      bgPort.postMessage({
        action: "speak",
        conn: fetch.conn,
        id: paraId,
        text: fetch.text,
        voice,
      });
    } else {
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
    return Promise.resolve();
  }

  // Not dispatched yet — dispatch it now
  if (!buffers.has(paraIndex)) {
    const fetch = scheduler.getNextFetch();
    if (fetch) dispatchFetch(fetch);
  }

  // Wait for done event (covers both in-flight and just-dispatched)
  return new Promise((resolve) => {
    // Double-check after microtask in case it completed
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
    controls.setPlaying(false);
    return;
  }

  currentParaIndex = paraIndex;

  // Mark paragraph as current in UI
  document.querySelectorAll("p[data-para]").forEach((p) => p.classList.remove("current-para"));
  const paraEl = document.querySelector(`p[data-para="${paraIndex}"]`);
  if (paraEl) paraEl.classList.add("current-para");

  // Ensure current paragraph is buffered (may already be in-flight from prefetcher)
  await ensureBuffered(paraIndex);

  // Trigger adaptive prefetch for upcoming paragraphs
  tryPrefetch();

  // Decode and play
  const buf = buffers.get(paraIndex);
  if (!buf || buf.audioChunks.length === 0) {
    await playFromParagraph(paraIndex + 1);
    return;
  }

  try {
    const audioBuffer = await player.decodeAudio(buf.audioChunks);

    highlight.loadParagraph(paraIndex);
    highlight.addWordEvents(buf.wordEvents);

    player.play(audioBuffer, async () => {
      highlight.stop();
      if (paraEl) {
        paraEl.classList.remove("current-para");
        paraEl.classList.add("played");
      }
      // Release audio data
      buf.audioChunks = [];
      scheduler.onPlaybackComplete();

      // Trigger prefetch check after playback advances
      tryPrefetch();

      if (controls.isPlaying) {
        await playFromParagraph(paraIndex + 1);
      }
    });

    highlight.start(() => player.getCurrentTimeMs());
  } catch (err) {
    console.error(`Lactor: failed to decode audio for para ${paraIndex}`, err);
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
