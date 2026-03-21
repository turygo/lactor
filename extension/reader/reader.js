import { splitIntoParagraphs, renderParagraphs } from "./components/normalizer.js";
import { HighlightEngine } from "./components/highlight.js";
import { Player } from "./components/player.js";
import { Controls } from "./components/controls.js";

const DEFAULT_PORT = 7890;
const MAX_RECONNECT = 3;

let port = DEFAULT_PORT;
let paragraphs = [];
let currentParaIndex = 0;
let voice = "en-US-AriaNeural";

const player = new Player();
const highlight = new HighlightEngine();

const contentEl = document.getElementById("content");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");

// Dual WebSocket connections
let wsA = null;
let wsB = null;
let reconnectCountA = 0;
let reconnectCountB = 0;

// Buffers: paraId -> { audioChunks: [], wordEvents: [], done: bool, buffer: AudioBuffer|null }
const buffers = new Map();

// Track which WS is playing and which is prefetching
let playingWs = "A";

// Pending speak requests: paraId -> { resolve, ws }
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
    if (result.port) port = result.port;
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
    await controls.loadVoices(port);
    if (controls.selectedVoice) voice = controls.selectedVoice;

    // Connect WebSockets
    connectWS();
  } catch (err) {
    showError(`Failed to load content: ${err.message}`);
  }
}

function showError(msg) {
  loadingEl.style.display = "none";
  errorEl.textContent = msg;
  errorEl.style.display = "block";
}

function connectWS() {
  const url = `ws://localhost:${port}/tts`;
  wsA = createWS(url, "A");
  wsB = createWS(url, "B");
}

function createWS(url, label) {
  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const paraId = msg.id;

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
  };

  ws.onclose = () => {
    const count = label === "A" ? reconnectCountA : reconnectCountB;
    if (count < MAX_RECONNECT) {
      if (label === "A") reconnectCountA++;
      else reconnectCountB++;
      setTimeout(() => {
        const newWs = createWS(url, label);
        if (label === "A") wsA = newWs;
        else wsB = newWs;
      }, 1000);
    }
  };

  ws.onerror = () => {};

  return ws;
}

function getWs(label) {
  return label === "A" ? wsA : wsB;
}

function sendSpeak(ws, paraIndex) {
  const paraId = `para-${paraIndex}`;
  const text = paragraphs[paraIndex];
  buffers.set(paraId, { audioChunks: [], wordEvents: [], done: false, buffer: null });

  return new Promise((resolve) => {
    pendingRequests.set(paraId, { resolve, ws });

    const trySend = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "speak", id: paraId, text, voice }));
      } else if (ws.readyState === WebSocket.CONNECTING) {
        setTimeout(trySend, 100);
      } else {
        resolve(); // WS closed, give up
      }
    };
    trySend();
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

  // Request current paragraph on playing WS if not already buffered
  const currentWs = getWs(playingWs);
  if (!buffers.has(paraId) || !buffers.get(paraId).done) {
    await sendSpeak(currentWs, paraIndex);
  }

  // Start prefetching next paragraph on the other WS
  const prefetchWs = getWs(playingWs === "A" ? "B" : "A");
  const nextParaIndex = paraIndex + 1;
  if (nextParaIndex < paragraphs.length) {
    const nextParaId = `para-${nextParaIndex}`;
    if (!buffers.has(nextParaId) || !buffers.get(nextParaId).done) {
      sendSpeak(prefetchWs, nextParaIndex); // fire and forget
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

      // Swap WS roles
      playingWs = playingWs === "A" ? "B" : "A";

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
  if (wsA && wsA.readyState <= WebSocket.OPEN) wsA.close();
  if (wsB && wsB.readyState <= WebSocket.OPEN) wsB.close();
  buffers.clear();
  pendingRequests.clear();
}

window.addEventListener("beforeunload", cleanup);

init();
