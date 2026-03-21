import { splitIntoParagraphs, renderParagraphs } from "./components/normalizer.js";
import { HighlightEngine } from "./components/highlight.js";
import { Player } from "./components/player.js";
import { Controls } from "./components/controls.js";

const DEFAULT_PORT = 7890;

let backendPort = DEFAULT_PORT;
let paragraphs = [];
let currentParaIndex = 0;
let voice = "en-US-AriaNeural";

const player = new Player();
const highlight = new HighlightEngine();

const contentEl = document.getElementById("content");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");

// Port connection to background script (WebSocket proxy)
let bgPort = null;
let bgConnected = false;

// Buffers: paraId -> { audioChunks: [], wordEvents: [], done: bool, buffer: AudioBuffer|null }
const buffers = new Map();

// Track which conn (0 or 1) is playing and which is prefetching
let playingConn = 0;

// Pending speak requests: paraId -> { resolve }
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
  // Send ready handshake to parent
  window.parent.postMessage({ type: "lactor-ready" }, "*");

  // Get port from storage
  try {
    const result = await browser.storage.local.get("port");
    if (result.port) backendPort = result.port;
  } catch {}

  // Get tabId from URL params
  const params = new URLSearchParams(location.search);
  const tabId = parseInt(params.get("tabId"), 10);
  if (isNaN(tabId)) {
    showError("Invalid tab ID");
    return;
  }

  // Fetch content from background
  loadingEl.style.display = "block";
  try {
    const resp = await browser.runtime.sendMessage({ type: "getContent", tabId });
    if (!resp || !resp.data) {
      showError("No content available. Try clicking the Lactor icon again.");
      return;
    }

    // Parse and render
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

    // Load voices
    await controls.loadVoices(backendPort);
    if (controls.selectedVoice) voice = controls.selectedVoice;

    // Connect to background WebSocket proxy
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

    // TTS data messages: audio, word, done, error
    const paraId = msg.id;
    if (!paraId) return;

    if (!buffers.has(paraId)) {
      buffers.set(paraId, { audioChunks: [], wordEvents: [], done: false, buffer: null });
    }
    const buf = buffers.get(paraId);

    if (msg.type === "audio") {
      buf.audioChunks.push(msg.data);
    } else if (msg.type === "word") {
      buf.wordEvents.push(msg);
    } else if (msg.type === "done") {
      buf.done = true;
      const pending = pendingRequests.get(paraId);
      if (pending) {
        pending.resolve();
        pendingRequests.delete(paraId);
      }
    } else if (msg.type === "error") {
      console.error(`Lactor: TTS error for ${paraId}: ${msg.message}`);
      buf.done = true;
      const pending = pendingRequests.get(paraId);
      if (pending) {
        pending.resolve();
        pendingRequests.delete(paraId);
      }
    }
  });

  bgPort.onDisconnect.addListener(() => {
    bgConnected = false;
    bgPort = null;
  });

  // Tell background to establish WebSocket connections
  bgPort.postMessage({ action: "connect", port: backendPort });
}

function sendSpeak(conn, paraIndex) {
  const paraId = `para-${paraIndex}`;
  const text = paragraphs[paraIndex];
  buffers.set(paraId, { audioChunks: [], wordEvents: [], done: false, buffer: null });

  return new Promise((resolve) => {
    pendingRequests.set(paraId, { resolve });

    if (bgPort && bgConnected) {
      bgPort.postMessage({ action: "speak", conn, id: paraId, text, voice });
    } else {
      // Wait for connection then send
      const checkReady = () => {
        if (bgPort && bgConnected) {
          bgPort.postMessage({ action: "speak", conn, id: paraId, text, voice });
        } else {
          setTimeout(checkReady, 100);
        }
      };
      setTimeout(checkReady, 100);
    }
  });
}

async function handlePlay() {
  if (player.playing) return;

  // If we have a paused buffer, resume
  if (player._currentBuffer) {
    await player.resume();
    highlight.start(() => player.getCurrentTimeMs());
    return;
  }

  // Start from current paragraph
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
  const paraId = `para-${paraIndex}`;

  // Mark paragraph as current
  document.querySelectorAll("p[data-para]").forEach((p) => {
    p.classList.remove("current-para");
  });
  const paraEl = document.querySelector(`p[data-para="${paraIndex}"]`);
  if (paraEl) paraEl.classList.add("current-para");

  // Request current paragraph if not already buffered
  if (!buffers.has(paraId) || !buffers.get(paraId).done) {
    await sendSpeak(playingConn, paraIndex);
  }

  // Start prefetching next paragraph on the other connection
  const prefetchConn = playingConn === 0 ? 1 : 0;
  const nextParaIndex = paraIndex + 1;
  if (nextParaIndex < paragraphs.length) {
    const nextParaId = `para-${nextParaIndex}`;
    if (!buffers.has(nextParaId) || !buffers.get(nextParaId).done) {
      sendSpeak(prefetchConn, nextParaIndex); // fire and forget
    }
  }

  // Decode and play current paragraph
  const buf = buffers.get(paraId);
  if (!buf || buf.audioChunks.length === 0) {
    // Skip empty paragraph (TTS error or empty audio)
    await playFromParagraph(paraIndex + 1);
    return;
  }

  try {
    const audioBuffer = await player.decodeAudio(buf.audioChunks);
    buf.buffer = audioBuffer;

    // Set up highlight
    highlight.loadParagraph(paraIndex);
    highlight.addWordEvents(buf.wordEvents);

    // Play with onEnded callback for next paragraph
    player.play(audioBuffer, async () => {
      highlight.stop();
      // Mark as played
      if (paraEl) {
        paraEl.classList.remove("current-para");
        paraEl.classList.add("played");
      }
      // Release audio data
      buf.audioChunks = [];
      buf.buffer = null;

      // Swap connection roles
      playingConn = playingConn === 0 ? 1 : 0;

      // Play next
      if (controls.isPlaying) {
        await playFromParagraph(paraIndex + 1);
      }
    });

    highlight.start(() => player.getCurrentTimeMs());
  } catch (err) {
    console.error(`Lactor: failed to decode audio for para ${paraIndex}`, err);
    // Skip to next paragraph
    await playFromParagraph(paraIndex + 1);
  }
}

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
