/**
 * createReader(deps) — testable orchestrator factory for the Lactor reader view.
 *
 * All browser API, UI, and component dependencies are injected via `deps`.
 * The thin entry point (reader.js) wires real dependencies and calls init().
 *
 * @param {object} deps
 * @param {object} deps.ui            — ReaderUI interface (showLoading, showError, markCurrent, etc.)
 * @param {object} deps.env           — window (postMessage) and location (search params)
 * @param {object} deps.browser       — browser.runtime / browser.storage
 * @param {object} deps.components    — factory functions for Player, Highlight, Controls, Scheduler, PlaybackState
 * @param {object} deps.functions     — pure functions (pipeline, voice, config, etc.)
 * @returns {{ init(): Promise<void>, cleanup(): void, _ensureBuffered(i): Promise<void>, _dispatchFetch(f): void, _playFromParagraph(i): Promise<void> }}
 */
export function createReader(deps) {
  const { ui, env, browser, components, functions } = deps;

  // ── Internal state ──────────────────────────────────────────────
  let config = null;
  let paragraphs = [];
  let voice = "en-US-AriaNeural";
  let currentLang = "en";
  let userChangedVoice = false;
  let scheduler = null;
  let log = null;
  let playbackState = null;

  let bgPort = null;
  let bgConnected = false;
  const buffers = new Map();
  const pendingRequests = new Map();
  const activeRetryTimers = new Set();
  let reconnectPending = false;

  // ── Components ──────────────────────────────────────────────────
  const player = components.createPlayer();
  const highlight = components.createHighlight();
  let controls = null;

  // ── init ────────────────────────────────────────────────────────

  async function init() {
    let debug = false;
    try {
      debug = await functions.isDebugMode();
    } catch {
      debug = true;
    }
    const logger = new functions.Logger(debug);
    log = logger.scope("reader");

    // Create playback state machine (paragraphCount set after pipeline)
    playbackState = components.createPlaybackState({
      paragraphCount: 0,
      log,
    });

    // Controls created after logger so we can inject a scoped logger
    controls = components.createControls(
      {
        onPlay: handlePlay,
        onPause: handlePause,
        onVoiceChange: (v) => {
          voice = v;
          userChangedVoice = true;
          functions.saveVoicePref(currentLang, v, browser.storage.local);
        },
        onClose: () => {
          cleanup();
          env.window.parent.postMessage({ type: "lactor-close" }, "*");
        },
      },
      { log: logger.scope("controls") }
    );

    // Wire state machine → controls sync
    playbackState.on("stateChange", ({ to }) => {
      const playing = to === "playing";
      controls.setPlaying(playing);
    });

    env.window.parent.postMessage({ type: "lactor-ready" }, "*");

    config = await functions.loadConfig(browser.storage.local);

    const params = new URLSearchParams(env.location.search);
    const tabId = parseInt(params.get("tabId"), 10);
    if (isNaN(tabId)) {
      ui.showError("Invalid tab ID");
      return;
    }

    ui.showLoading();
    try {
      const resp = await browser.runtime.sendMessage({ type: "getContent", tabId });
      if (!resp || !resp.data) {
        ui.showError("No content available. Try clicking the Lactor icon again.");
        return;
      }

      const pipeline = functions.createPipeline([functions.sanitize, functions.structure]);
      const ctx = pipeline.run(resp.data.content, { lang: resp.data.lang || "" });
      const segments = ctx.segments || [];
      paragraphs = segments.map((s) => s.text);

      if (paragraphs.length === 0) {
        ui.showError("Could not extract readable text from this page.");
        return;
      }

      // Update state machine with actual paragraph count
      playbackState.paragraphCount = paragraphs.length;

      ui.renderContent(segments, resp.data.url);
      ui.setTitle(resp.data.title);
      ui.hideLoading();

      // Voice resolution: cache-first, then fresh
      currentLang = ctx.lang || "en";
      const prefs = await functions.loadVoicePrefs(browser.storage.local);
      const userPref = prefs[currentLang] || "";

      const cached = await functions.loadCachedVoices(browser.storage.local);
      if (cached && cached.length > 0) {
        controls.populateVoices(cached);
        const resolved = functions.resolveVoice(currentLang, cached, userPref);
        if (resolved) {
          voice = resolved;
          controls.setVoice(resolved);
        }
      }

      const fresh = await functions.fetchVoices(config);
      if (fresh.length > 0) {
        functions.cacheVoices(fresh, browser.storage.local);
        if (!userChangedVoice) {
          controls.populateVoices(fresh);
          const resolved = functions.resolveVoice(currentLang, fresh, userPref);
          if (resolved) {
            voice = resolved;
            controls.setVoice(resolved);
          }
        }
      } else if (!cached && controls.selectedVoice) {
        voice = controls.selectedVoice;
      }

      scheduler = components.createScheduler(paragraphs, 3);
      connectToBg();
    } catch (err) {
      ui.showError(`Failed to load content: ${err.message}`);
    }
  }

  // ── Port communication ──────────────────────────────────────────

  function connectToBg() {
    bgPort = browser.runtime.connect({ name: "lactor-tts" });

    bgPort.onMessage.addListener((msg) => {
      if (msg.type === "connected") {
        bgConnected = true;
        reconnectPending = false;
        log.log("background WS connected");
        return;
      }
      if (msg.type === "ws-error") {
        log.warn(`WS conn ${msg.conn} error: ${msg.message}`);
        bgConnected = false;
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
        scheduler.onFetchComplete(paraIndex);
        resolvePending(paraIndex);
        tryPrefetch();
      }
    });

    bgPort.onDisconnect.addListener(() => {
      bgConnected = false;
      bgPort = null;
    });
    bgPort.postMessage({ action: "connect", wsEndpoint: config.wsUrl() });
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
    bgPort.postMessage({ action: "connect", wsEndpoint: config.wsUrl() });
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
        return;
      }
      if (!bgPort) return;
      retries++;
      if (retries === 1 && !reconnectPending) {
        log.log(`dispatch fetch: connection lost, triggering reconnect`);
        reconnectPending = true;
        reconnectBg();
      }
      if (retries > 50) {
        log.error(`dispatch fetch: gave up after ${retries} retries`);
        return;
      }
      const timerId = setTimeout(() => {
        activeRetryTimers.delete(timerId);
        send();
      }, 100);
      activeRetryTimers.add(timerId);
    };
    send();
  }

  function ensureBuffered(paraIndex) {
    if (buffers.has(paraIndex) && buffers.get(paraIndex).done) {
      log.log(`ensureBuffered: para ${paraIndex} already done`);
      return Promise.resolve();
    }

    if (!buffers.has(paraIndex)) {
      log.log(`ensureBuffered: para ${paraIndex} not dispatched, dispatching now`);
      const fetch = scheduler.fetchByIndex(paraIndex);
      if (fetch) dispatchFetch(fetch);
    } else {
      log.log(`ensureBuffered: para ${paraIndex} in-flight, waiting for done`);
    }

    return new Promise((resolve, reject) => {
      if (buffers.has(paraIndex) && buffers.get(paraIndex).done) {
        resolve();
        return;
      }
      pendingRequests.set(paraIndex, { resolve, reject });
    });
  }

  function tryPrefetch() {
    if (!scheduler) return;
    const remainingMs = player.getRemainingMs();
    while (scheduler.shouldPrefetch(remainingMs)) {
      const next = scheduler.getNextFetch();
      if (!next) break;
      dispatchFetch(next);
    }
  }

  // ── Playback ────────────────────────────────────────────────────

  async function handlePlay() {
    if (playbackState.isPlaying || playbackState.isLoading) return;

    if (!bgConnected && bgPort) {
      log.log("play: reconnecting WS before resume");
      reconnectBg();
    }

    if (player.hasBuffer) {
      playbackState.transition("play");
      playbackState.transition("buffered");
      try {
        await player.resume();
      } catch (err) {
        log.error("resume failed:", err);
        playbackState.transition("pause");
        return;
      }
      highlight.start(() => player.getCurrentTimeMs());
      return;
    }

    playbackState.transition("play");
    await playFromParagraph(playbackState.currentIndex);
  }

  async function handlePause() {
    // Use "cancel" from loading (pause is only valid from playing)
    if (playbackState.state === "loading") {
      playbackState.transition("cancel");
    } else {
      playbackState.transition("pause");
    }
    await player.pause();
    highlight.stop();
  }

  /**
   * Play a single segment: buffer → decode → play → wait for end.
   * Returns { shouldContinue, skipped } to let the caller drive the loop.
   */
  async function playSingleSegment(paraIndex) {
    log.log(`playSingleSegment(${paraIndex}/${paragraphs.length - 1})`);
    ui.markCurrent(paraIndex);

    // Ensure we're in loading state
    if (playbackState.state !== "loading") {
      if (!playbackState.transition("play")) return { shouldContinue: false };
    }

    try {
      await ensureBuffered(paraIndex);
    } catch {
      return { shouldContinue: false }; // cleanup was called
    }

    // Bail out if cancelled/paused during loading
    if (playbackState.state !== "loading") return { shouldContinue: false };

    tryPrefetch();

    const buf = buffers.get(paraIndex);
    if (!buf || buf.audioChunks.length === 0) {
      log.warn(`para ${paraIndex} has no audio chunks, skipping`);
      return { shouldContinue: true, skipped: true };
    }

    try {
      log.log(`para ${paraIndex} decoding ${buf.audioChunks.length} chunks...`);
      const audioBuffer = await player.decodeAudio(buf.audioChunks);
      log.log(`para ${paraIndex} decoded, duration=${audioBuffer.duration.toFixed(2)}s, playing`);

      playbackState.transition("buffered");

      highlight.loadParagraph(paraIndex);
      highlight.addWordEvents(buf.wordEvents);

      const shouldContinue = await new Promise((resolve) => {
        player.play(audioBuffer, () => {
          log.log(`para ${paraIndex} playback ended, isPlaying=${playbackState.isPlaying}`);
          highlight.stop();
          ui.markPlayed(paraIndex);
          buffers.delete(paraIndex);
          scheduler.onPlaybackComplete();
          tryPrefetch();
          resolve(playbackState.isPlaying);
        });

        highlight.start(() => player.getCurrentTimeMs());
      });

      return { shouldContinue };
    } catch (err) {
      log.error(`decode failed para ${paraIndex}:`, err);
      playbackState.transition("error");
      playbackState.transition("cancel");
      return { shouldContinue: false };
    }
  }

  async function playFromParagraph(startIndex) {
    let paraIndex = startIndex;

    while (paraIndex < paragraphs.length) {
      const result = await playSingleSegment(paraIndex);

      if (!result.shouldContinue) return;

      if (result.skipped) {
        playbackState.advanceIndex();
        paraIndex = playbackState.currentIndex;
        continue;
      }

      // Segment played successfully — advance
      const hasMore = playbackState.advanceIndex();
      if (!hasMore) {
        playbackState.transition("finished");
        return;
      }

      playbackState.transition("ended");
      paraIndex = playbackState.currentIndex;
    }

    log.log("all paragraphs finished");
    if (!playbackState.transition("finished") && !playbackState.transition("cancel")) {
      controls.setPlaying(false);
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  function cleanup() {
    if (playbackState) playbackState.transition("cancel");
    for (const id of activeRetryTimers) clearTimeout(id);
    activeRetryTimers.clear();
    reconnectPending = false;
    player.destroy();
    highlight.reset();
    if (bgPort) {
      bgPort.postMessage({ action: "close" });
      bgPort.disconnect();
      bgPort = null;
    }
    buffers.clear();
    for (const { reject } of pendingRequests.values()) {
      reject(new Error("cleanup"));
    }
    pendingRequests.clear();
  }

  // ── Public API ──────────────────────────────────────────────────

  return {
    init,
    cleanup,
    // Exposed for testing (prefixed with _)
    _ensureBuffered: ensureBuffered,
    _dispatchFetch: dispatchFetch,
    _playFromParagraph: playFromParagraph,
  };
}
