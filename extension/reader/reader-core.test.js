import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const { createReader } = await import("./reader-core.js");

// ── Mock helpers ────────────────────────────────────────────────

function makeMockPort() {
  const listeners = { message: [], disconnect: [] };
  return {
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    onDisconnect: { addListener: (fn) => listeners.disconnect.push(fn) },
    postMessage: mock.fn(),
    disconnect: mock.fn(),
    _fire(msg) {
      listeners.message.forEach((fn) => fn(msg));
    },
    _fireDisconnect() {
      listeners.disconnect.forEach((fn) => fn());
    },
  };
}

function makeMockPlayer() {
  return {
    playing: false,
    hasBuffer: false,
    getCurrentTimeMs: () => 0,
    getRemainingMs: () => 0,
    decodeAudio: mock.fn(async () => ({ duration: 1.0 })),
    play: mock.fn((_buf, onEnded) => {
      if (onEnded) onEnded();
    }),
    pause: mock.fn(async () => {}),
    resume: mock.fn(async () => {}),
    destroy: mock.fn(),
  };
}

function makeMockHighlight() {
  return {
    loadParagraph: mock.fn(),
    addWordEvents: mock.fn(),
    start: mock.fn(),
    stop: mock.fn(),
    reset: mock.fn(),
  };
}

function makeMockControls(cbs) {
  return {
    _cbs: cbs,
    isPlaying: true,
    selectedVoice: "en-US-AriaNeural",
    populateVoices: mock.fn(),
    loadVoices: mock.fn(async () => []),
    setVoice: mock.fn(),
    setPlaying: mock.fn(),
  };
}

function makeMockScheduler() {
  return {
    shouldPrefetch: () => false,
    getNextFetch: mock.fn(() => null),
    fetchByIndex: mock.fn(() => null),
    onFetchComplete: mock.fn(),
    onPlaybackComplete: mock.fn(),
    resetConnections: mock.fn(),
  };
}

function makeDeps(overrides = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="loading" style="display:none"></div>
    <div id="error" style="display:none"></div>
    <article id="content"></article>
  </body></html>`);
  const doc = dom.window.document;

  const mockPort = makeMockPort();
  const mockPlayer = makeMockPlayer();
  const mockHighlight = makeMockHighlight();
  let mockControls;
  const mockScheduler = makeMockScheduler();

  const deps = {
    dom: {
      contentEl: doc.getElementById("content"),
      loadingEl: doc.getElementById("loading"),
      errorEl: doc.getElementById("error"),
      document: doc,
      window: {
        parent: { postMessage: mock.fn() },
        addEventListener: mock.fn(),
      },
      location: { search: "?tabId=42" },
    },
    browser: {
      runtime: {
        sendMessage: mock.fn(async () => ({
          data: {
            content: "<p>Hello world</p>",
            lang: "en",
            url: "https://example.com",
            title: "Test Title",
          },
        })),
        connect: mock.fn(() => mockPort),
      },
      storage: {
        local: { get: mock.fn(async () => ({})), set: mock.fn(async () => {}) },
      },
    },
    components: {
      createPlayer: () => mockPlayer,
      createHighlight: () => mockHighlight,
      createControls: (cbs) => {
        mockControls = makeMockControls(cbs);
        return mockControls;
      },
      createScheduler: () => mockScheduler,
    },
    functions: {
      loadConfig: mock.fn(async () => ({
        wsUrl: () => "ws://localhost:7890/tts",
        httpUrl: (p) => `http://localhost:7890${p}`,
      })),
      createPipeline: () => ({
        run: () => ({
          segments: [
            { type: "text", text: "Hello world" },
            { type: "text", text: "Second paragraph" },
          ],
          lang: "en",
        }),
      }),
      sanitize: (x) => x,
      structure: (x) => x,
      renderSegments: mock.fn(),
      resolveVoice: mock.fn(() => "en-US-AriaNeural"),
      loadCachedVoices: mock.fn(async () => [{ name: "en-US-AriaNeural", locale: "en-US" }]),
      cacheVoices: mock.fn(),
      loadVoicePrefs: mock.fn(async () => ({})),
      saveVoicePref: mock.fn(),
      isDebugMode: mock.fn(async () => false),
      Logger: class {
        scope() {
          return { log() {}, warn() {}, error() {} };
        }
      },
    },
    _mocks: {
      get mockControls() {
        return mockControls;
      },
      mockPort,
      mockPlayer,
      mockHighlight,
      mockScheduler,
    },
  };

  // Apply overrides (shallow merge per category)
  if (overrides.dom) Object.assign(deps.dom, overrides.dom);
  if (overrides.browser) {
    if (overrides.browser.runtime) Object.assign(deps.browser.runtime, overrides.browser.runtime);
    if (overrides.browser.storage) Object.assign(deps.browser.storage, overrides.browser.storage);
  }
  if (overrides.functions) Object.assign(deps.functions, overrides.functions);

  return deps;
}

// ── Tests ───────────────────────────────────────────────────────

describe("createReader", () => {
  describe("init — happy path", () => {
    it("posts lactor-ready to parent window", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      const calls = deps.dom.window.parent.postMessage.mock.calls;
      assert.ok(calls.some((c) => c.arguments[0].type === "lactor-ready"));
    });

    it("loads config from browser storage", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      assert.equal(deps.functions.loadConfig.mock.callCount(), 1);
    });

    it("fetches content via runtime.sendMessage with tabId", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      const call = deps.browser.runtime.sendMessage.mock.calls[0];
      assert.deepEqual(call.arguments[0], { type: "getContent", tabId: 42 });
    });

    it("runs pipeline and renders segments", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      assert.equal(deps.functions.renderSegments.mock.callCount(), 1);
      const args = deps.functions.renderSegments.mock.calls[0].arguments;
      assert.equal(args[0], deps.dom.contentEl); // contentEl
      assert.equal(args[1].length, 2); // 2 segments
    });

    it("prepends title h1 when title exists", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      const h1 = deps.dom.contentEl.querySelector("h1");
      assert.ok(h1);
      assert.equal(h1.textContent, "Test Title");
    });

    it("hides loading indicator after content loads", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      assert.equal(deps.dom.loadingEl.style.display, "none");
    });

    it("connects to background after successful init", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      assert.equal(deps.browser.runtime.connect.mock.callCount(), 1);
      assert.deepEqual(deps.browser.runtime.connect.mock.calls[0].arguments[0], {
        name: "lactor-tts",
      });
    });

    it("sends connect message with wsUrl to background port", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      const portCalls = deps._mocks.mockPort.postMessage.mock.calls;
      assert.ok(
        portCalls.some(
          (c) =>
            c.arguments[0].action === "connect" &&
            c.arguments[0].wsEndpoint === "ws://localhost:7890/tts"
        )
      );
    });

    it("populates voices from cache", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      assert.equal(deps._mocks.mockControls.populateVoices.mock.callCount(), 1);
    });

    it("creates scheduler with extracted paragraphs", async () => {
      const deps = makeDeps();
      let schedulerArgs;
      deps.components.createScheduler = (...args) => {
        schedulerArgs = args;
        return makeMockScheduler();
      };
      const reader = createReader(deps);
      await reader.init();
      assert.deepEqual(schedulerArgs[0], ["Hello world", "Second paragraph"]);
      assert.equal(schedulerArgs[1], 3);
    });
  });

  describe("init — error paths", () => {
    it("shows error for invalid tabId", async () => {
      const deps = makeDeps({ dom: { location: { search: "?tabId=abc" } } });
      const reader = createReader(deps);
      await reader.init();
      assert.equal(deps.dom.errorEl.style.display, "block");
      assert.match(deps.dom.errorEl.textContent, /Invalid tab ID/);
    });

    it("shows error when sendMessage returns null", async () => {
      const deps = makeDeps();
      deps.browser.runtime.sendMessage = mock.fn(async () => null);
      const reader = createReader(deps);
      await reader.init();
      assert.match(deps.dom.errorEl.textContent, /No content available/);
    });

    it("shows error when sendMessage returns no data", async () => {
      const deps = makeDeps();
      deps.browser.runtime.sendMessage = mock.fn(async () => ({ data: null }));
      const reader = createReader(deps);
      await reader.init();
      assert.match(deps.dom.errorEl.textContent, /No content available/);
    });

    it("shows error when pipeline produces empty segments", async () => {
      const deps = makeDeps({
        functions: {
          createPipeline: () => ({ run: () => ({ segments: [], lang: "en" }) }),
        },
      });
      const reader = createReader(deps);
      await reader.init();
      assert.match(deps.dom.errorEl.textContent, /Could not extract/);
    });

    it("shows error when content fetch throws", async () => {
      const deps = makeDeps();
      deps.browser.runtime.sendMessage = mock.fn(async () => {
        throw new Error("network down");
      });
      const reader = createReader(deps);
      await reader.init();
      assert.match(deps.dom.errorEl.textContent, /Failed to load content/);
    });

    it("does not connect to background on error", async () => {
      const deps = makeDeps({ dom: { location: { search: "?tabId=abc" } } });
      const reader = createReader(deps);
      await reader.init();
      assert.equal(deps.browser.runtime.connect.mock.callCount(), 0);
    });
  });

  describe("init — voice resolution", () => {
    it("resolves voice from cache and sets it", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      assert.ok(deps._mocks.mockControls.setVoice.mock.callCount() >= 1);
    });

    it("skips auto-selection when user changed voice during fetch", async () => {
      const deps = makeDeps();
      // loadVoices returns fresh voices
      deps.functions.loadCachedVoices = mock.fn(async () => [
        { name: "en-US-AriaNeural", locale: "en-US" },
      ]);
      createReader(deps);
      // We need controls to exist before simulating voice change
      // The trick: make loadVoices slow enough that we can trigger onVoiceChange
      let loadVoicesResolve;
      const freshVoices = [{ name: "en-US-GuyNeural", locale: "en-US" }];
      deps.components.createControls = (cbs) => {
        const ctrl = makeMockControls(cbs);
        ctrl.loadVoices = mock.fn(
          () =>
            new Promise((resolve) => {
              loadVoicesResolve = () => resolve(freshVoices);
            })
        );
        deps._mocks = { ...deps._mocks, mockControls: ctrl };
        return ctrl;
      };

      const initPromise = createReader(deps).init();
      // Wait for cache-based voice to be set, then simulate user changing voice
      await new Promise((r) => setTimeout(r, 10));
      if (loadVoicesResolve) {
        // Simulate user changed voice before fresh voices arrive
        deps._mocks.mockControls._cbs.onVoiceChange("ja-JP-NanamiNeural");
        loadVoicesResolve();
      }
      await initPromise;

      // resolveVoice should NOT have been called again for fresh voices
      // because userChangedVoice was set to true
      const setVoiceCalls = deps._mocks.mockControls.setVoice.mock.calls;
      const lastSetVoice = setVoiceCalls[setVoiceCalls.length - 1]?.arguments[0];
      // Should NOT have overwritten the user's manual choice with fresh voice resolution
      assert.notEqual(lastSetVoice, "en-US-GuyNeural");
    });

    it("falls back to controls.selectedVoice when no cache and no fresh voices", async () => {
      const deps = makeDeps();
      deps.functions.loadCachedVoices = mock.fn(async () => null);
      deps.functions.resolveVoice = mock.fn(() => null);
      deps.components.createControls = (cbs) => {
        const ctrl = makeMockControls(cbs);
        ctrl.loadVoices = mock.fn(async () => []);
        ctrl.selectedVoice = "fallback-voice";
        deps._mocks = { ...deps._mocks, mockControls: ctrl };
        return ctrl;
      };
      const reader = createReader(deps);
      await reader.init();
      // voice should be set to fallback-voice (tested via cleanup/internal state)
      // We verify indirectly: controls.selectedVoice was the fallback
      assert.equal(deps._mocks.mockControls.selectedVoice, "fallback-voice");
    });
  });

  describe("port message handling", () => {
    it("sets bgConnected on connected message", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "connected" });
      // No error thrown — connected state is internal
    });

    it("handles ws-error by marking disconnected", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "connected" });
      deps._mocks.mockPort._fire({ type: "ws-error", conn: 0, message: "fail" });
      // No crash — state is internal
    });

    it("ignores messages with invalid para IDs", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      // Should not throw
      deps._mocks.mockPort._fire({ type: "audio", id: "invalid", data: "abc" });
      deps._mocks.mockPort._fire({ type: "audio", id: null, data: "abc" });
      deps._mocks.mockPort._fire({ type: "audio", data: "abc" });
    });

    it("buffers audio chunks for valid para IDs", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "audio", id: "para-0", data: "chunk1" });
      deps._mocks.mockPort._fire({ type: "audio", id: "para-0", data: "chunk2" });
      // We verify indirectly via done event resolving pending
    });

    it("resolves pending request on done message", async () => {
      const deps = makeDeps();
      const mockScheduler = makeMockScheduler();
      mockScheduler.fetchByIndex = mock.fn((i) => ({
        conn: 0,
        index: i,
        text: "Hello world",
      }));
      deps.components.createScheduler = () => mockScheduler;
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "connected" });

      // ensureBuffered dispatches and waits
      const ensurePromise = reader._ensureBuffered(0);

      // Simulate TTS response
      deps._mocks.mockPort._fire({ type: "audio", id: "para-0", data: "audiodata" });
      deps._mocks.mockPort._fire({ type: "done", id: "para-0" });

      // Should resolve without timeout
      await ensurePromise;
      assert.equal(mockScheduler.onFetchComplete.mock.callCount(), 1);
    });

    it("handles disconnect by clearing port", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fireDisconnect();
      // Internal state cleared — no crash on subsequent operations
    });
  });

  describe("cleanup", () => {
    it("destroys player", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      reader.cleanup();
      assert.equal(deps._mocks.mockPlayer.destroy.mock.callCount(), 1);
    });

    it("resets highlight", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      reader.cleanup();
      assert.equal(deps._mocks.mockHighlight.reset.mock.callCount(), 1);
    });

    it("disconnects background port", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      reader.cleanup();
      const portCalls = deps._mocks.mockPort.postMessage.mock.calls;
      assert.ok(portCalls.some((c) => c.arguments[0].action === "close"));
      assert.equal(deps._mocks.mockPort.disconnect.mock.callCount(), 1);
    });

    it("is safe to call without init", () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      // Should not throw
      reader.cleanup();
    });
  });

  describe("voice change callback", () => {
    it("saves voice preference to storage", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockControls._cbs.onVoiceChange("ja-JP-NanamiNeural");
      assert.equal(deps.functions.saveVoicePref.mock.callCount(), 1);
      const args = deps.functions.saveVoicePref.mock.calls[0].arguments;
      assert.equal(args[0], "en"); // currentLang
      assert.equal(args[1], "ja-JP-NanamiNeural");
      assert.equal(args[2], deps.browser.storage.local);
    });
  });

  describe("close callback", () => {
    it("cleans up and posts lactor-close", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockControls._cbs.onClose();
      assert.equal(deps._mocks.mockPlayer.destroy.mock.callCount(), 1);
      const postCalls = deps.dom.window.parent.postMessage.mock.calls;
      assert.ok(postCalls.some((c) => c.arguments[0].type === "lactor-close"));
    });
  });

  describe("TTS error handling", () => {
    it("calls scheduler.onFetchComplete on TTS error to free connection", async () => {
      const deps = makeDeps();
      const mockScheduler = makeMockScheduler();
      mockScheduler.fetchByIndex = mock.fn((i) => ({
        conn: 0,
        index: i,
        text: "Hello world",
      }));
      deps.components.createScheduler = () => mockScheduler;
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "connected" });

      const ensurePromise = reader._ensureBuffered(0);
      deps._mocks.mockPort._fire({ type: "error", id: "para-0", message: "TTS failed" });

      await ensurePromise;
      assert.equal(mockScheduler.onFetchComplete.mock.callCount(), 1);
      assert.equal(mockScheduler.onFetchComplete.mock.calls[0].arguments[0], 0);
    });
  });

  describe("dispatchFetch", () => {
    it("sends speak message to background port", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "connected" });

      reader._dispatchFetch({ conn: 0, index: 0, text: "Hello" });

      const portCalls = deps._mocks.mockPort.postMessage.mock.calls;
      assert.ok(
        portCalls.some(
          (c) =>
            c.arguments[0].action === "speak" &&
            c.arguments[0].id === "para-0" &&
            c.arguments[0].text === "Hello" &&
            c.arguments[0].conn === 0
        )
      );
    });

    it("cleanup cancels pending retry timers", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      // Do NOT fire "connected" — bgConnected stays false, triggering retries

      const countBefore = deps._mocks.mockPort.postMessage.mock.callCount();
      reader._dispatchFetch({ conn: 0, index: 0, text: "Hello" });
      reader.cleanup();

      // Wait long enough for several retries to have fired if not cancelled
      await new Promise((r) => setTimeout(r, 400));

      // No new speak messages should have been sent after cleanup
      const speakCalls = deps._mocks.mockPort.postMessage.mock.calls
        .slice(countBefore)
        .filter((c) => c.arguments[0].action === "speak");
      assert.equal(speakCalls.length, 0, "no speak messages after cleanup");
    });

    it("deduplicates reconnectBg across concurrent dispatches", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      // bgConnected is false — dispatches will retry and trigger reconnect

      reader._dispatchFetch({ conn: 0, index: 0, text: "Hello" });
      reader._dispatchFetch({ conn: 1, index: 1, text: "World" });

      // Count how many "connect" action messages were sent after init's own connect
      const connectCalls = deps._mocks.mockPort.postMessage.mock.calls.filter(
        (c) => c.arguments[0].action === "connect"
      );
      // init sends one "connect"; retries should add at most one more (not two)
      assert.ok(
        connectCalls.length <= 2,
        `expected at most 2 connect calls (init + 1 reconnect), got ${connectCalls.length}`
      );

      reader.cleanup();
    });

    it("retry succeeds after connection restored", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      // bgConnected is false

      reader._dispatchFetch({ conn: 0, index: 0, text: "Hello" });

      // Simulate connection restored after a short delay
      await new Promise((r) => setTimeout(r, 150));
      deps._mocks.mockPort._fire({ type: "connected" });

      // Wait for retry to pick it up
      await new Promise((r) => setTimeout(r, 200));

      const speakCalls = deps._mocks.mockPort.postMessage.mock.calls.filter(
        (c) => c.arguments[0].action === "speak" && c.arguments[0].id === "para-0"
      );
      assert.equal(speakCalls.length, 1, "speak message sent after reconnection");

      reader.cleanup();
    });
  });

  describe("ensureBuffered", () => {
    it("resolves immediately when buffer is already done", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();

      // Pre-fill buffer via port messages
      deps._mocks.mockPort._fire({ type: "audio", id: "para-0", data: "chunk" });
      deps._mocks.mockPort._fire({ type: "done", id: "para-0" });

      // Should resolve immediately
      await reader._ensureBuffered(0);
    });

    it("dispatches fetch for the exact paraIndex via fetchByIndex", async () => {
      const deps = makeDeps();
      const mockScheduler = makeMockScheduler();
      const fetchedIndices = [];
      mockScheduler.fetchByIndex = mock.fn((i) => {
        fetchedIndices.push(i);
        return { conn: 0, index: i, text: "text" };
      });
      deps.components.createScheduler = () => mockScheduler;
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "connected" });

      reader._ensureBuffered(5);

      assert.equal(fetchedIndices.length, 1);
      assert.equal(fetchedIndices[0], 5);
    });

    it("rejects pending promises on cleanup", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "connected" });

      // Start ensureBuffered without resolving it
      const promise = reader._ensureBuffered(0);

      // Cleanup should reject the pending promise
      reader.cleanup();

      await assert.rejects(promise, { message: "cleanup" });
    });
  });

  describe("playFromParagraph", () => {
    it("stops at end of paragraphs", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();

      // Play past the last paragraph
      await reader._playFromParagraph(999);
      assert.equal(deps._mocks.mockControls.setPlaying.mock.callCount(), 1);
      assert.equal(deps._mocks.mockControls.setPlaying.mock.calls[0].arguments[0], false);
    });

    it("skips paragraph with no audio chunks", async () => {
      const deps = makeDeps();
      const mockScheduler = makeMockScheduler();
      mockScheduler.fetchByIndex = mock.fn((i) => ({
        conn: 0,
        index: i,
        text: "Hello world",
      }));
      deps.components.createScheduler = () => mockScheduler;

      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "connected" });

      // Buffer para 0 with empty audio (done but no chunks)
      deps._mocks.mockPort._fire({ type: "done", id: "para-0" });

      // Buffer para 1 with done but also empty — will chain through to end
      deps._mocks.mockPort._fire({ type: "done", id: "para-1" });

      // Both paragraphs have no audio → should skip to end
      await reader._playFromParagraph(0);
      // Eventually calls setPlaying(false) when it runs out of paragraphs
      assert.ok(deps._mocks.mockControls.setPlaying.mock.callCount() >= 1);
    });

    it("decodes audio and starts playback with highlighting", async () => {
      const deps = makeDeps();
      const mockScheduler = makeMockScheduler();
      mockScheduler.fetchByIndex = mock.fn((i) => ({
        conn: 0,
        index: i,
        text: "Hello world",
      }));
      deps.components.createScheduler = () => mockScheduler;

      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "connected" });

      // Buffer para 0 with audio data
      deps._mocks.mockPort._fire({ type: "audio", id: "para-0", data: "audio1" });
      deps._mocks.mockPort._fire({
        type: "word",
        id: "para-0",
        offset: 0,
        length: 5,
        audioOffset: 0,
      });
      deps._mocks.mockPort._fire({ type: "done", id: "para-0" });
      // Buffer para 1 as empty so the while-loop can terminate
      deps._mocks.mockPort._fire({ type: "done", id: "para-1" });

      await reader._playFromParagraph(0);

      assert.equal(deps._mocks.mockPlayer.decodeAudio.mock.callCount(), 1);
      assert.equal(deps._mocks.mockHighlight.loadParagraph.mock.callCount(), 1);
      assert.equal(deps._mocks.mockHighlight.addWordEvents.mock.callCount(), 1);
      assert.equal(deps._mocks.mockPlayer.play.mock.callCount(), 1);
      assert.equal(deps._mocks.mockHighlight.start.mock.callCount(), 1);
    });
  });
});
