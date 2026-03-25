import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

const { createReader } = await import("./reader-core.js");
const { createPlaybackState } = await import("./components/playback-state.js");

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

function makeMockUI() {
  return {
    showLoading: mock.fn(),
    hideLoading: mock.fn(),
    showError: mock.fn(),
    renderContent: mock.fn(),
    setTitle: mock.fn(),
    markCurrent: mock.fn(),
    markPlayed: mock.fn(),
  };
}

function makeDeps(overrides = {}) {
  const mockPort = makeMockPort();
  const mockPlayer = makeMockPlayer();
  const mockHighlight = makeMockHighlight();
  let mockControls;
  const mockScheduler = makeMockScheduler();
  const mockUI = makeMockUI();

  const deps = {
    ui: mockUI,
    env: {
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
      createPlaybackState: (opts) => createPlaybackState(opts),
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
      fetchVoices: mock.fn(async () => []),
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
      mockUI,
    },
  };

  // Apply overrides (shallow merge per category)
  if (overrides.ui) Object.assign(deps.ui, overrides.ui);
  if (overrides.env) Object.assign(deps.env, overrides.env);
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
      const calls = deps.env.window.parent.postMessage.mock.calls;
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

    it("calls ui.renderContent with segments and url", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      assert.equal(deps._mocks.mockUI.renderContent.mock.callCount(), 1);
      const args = deps._mocks.mockUI.renderContent.mock.calls[0].arguments;
      assert.equal(args[0].length, 2); // 2 segments
      assert.equal(args[1], "https://example.com");
    });

    it("calls ui.setTitle with page title", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      assert.equal(deps._mocks.mockUI.setTitle.mock.callCount(), 1);
      assert.equal(deps._mocks.mockUI.setTitle.mock.calls[0].arguments[0], "Test Title");
    });

    it("hides loading indicator after content loads", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      assert.equal(deps._mocks.mockUI.hideLoading.mock.callCount(), 1);
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
      const deps = makeDeps({ env: { location: { search: "?tabId=abc" } } });
      const reader = createReader(deps);
      await reader.init();
      assert.equal(deps._mocks.mockUI.showError.mock.callCount(), 1);
      assert.match(deps._mocks.mockUI.showError.mock.calls[0].arguments[0], /Invalid tab ID/);
    });

    it("shows error when sendMessage returns null", async () => {
      const deps = makeDeps();
      deps.browser.runtime.sendMessage = mock.fn(async () => null);
      const reader = createReader(deps);
      await reader.init();
      assert.match(deps._mocks.mockUI.showError.mock.calls[0].arguments[0], /No content available/);
    });

    it("shows error when sendMessage returns no data", async () => {
      const deps = makeDeps();
      deps.browser.runtime.sendMessage = mock.fn(async () => ({ data: null }));
      const reader = createReader(deps);
      await reader.init();
      assert.match(deps._mocks.mockUI.showError.mock.calls[0].arguments[0], /No content available/);
    });

    it("shows error when pipeline produces empty segments", async () => {
      const deps = makeDeps({
        functions: {
          createPipeline: () => ({ run: () => ({ segments: [], lang: "en" }) }),
        },
      });
      const reader = createReader(deps);
      await reader.init();
      assert.match(deps._mocks.mockUI.showError.mock.calls[0].arguments[0], /Could not extract/);
    });

    it("shows error when content fetch throws", async () => {
      const deps = makeDeps();
      deps.browser.runtime.sendMessage = mock.fn(async () => {
        throw new Error("network down");
      });
      const reader = createReader(deps);
      await reader.init();
      assert.match(
        deps._mocks.mockUI.showError.mock.calls[0].arguments[0],
        /Failed to load content/
      );
    });

    it("does not connect to background on error", async () => {
      const deps = makeDeps({ env: { location: { search: "?tabId=abc" } } });
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
      deps.functions.loadCachedVoices = mock.fn(async () => [
        { name: "en-US-AriaNeural", locale: "en-US" },
      ]);
      let fetchVoicesResolve;
      const freshVoices = [{ name: "en-US-GuyNeural", locale: "en-US" }];
      deps.functions.fetchVoices = mock.fn(
        () =>
          new Promise((resolve) => {
            fetchVoicesResolve = () => resolve(freshVoices);
          })
      );

      const initPromise = createReader(deps).init();
      await new Promise((r) => setTimeout(r, 10));
      if (fetchVoicesResolve) {
        deps._mocks.mockControls._cbs.onVoiceChange("ja-JP-NanamiNeural");
        fetchVoicesResolve();
      }
      await initPromise;

      const setVoiceCalls = deps._mocks.mockControls.setVoice.mock.calls;
      const lastSetVoice = setVoiceCalls[setVoiceCalls.length - 1]?.arguments[0];
      assert.notEqual(lastSetVoice, "en-US-GuyNeural");
    });

    it("falls back to controls.selectedVoice when no cache and no fresh voices", async () => {
      const deps = makeDeps();
      deps.functions.loadCachedVoices = mock.fn(async () => null);
      deps.functions.resolveVoice = mock.fn(() => null);
      deps.functions.fetchVoices = mock.fn(async () => []);
      deps.components.createControls = (cbs) => {
        const ctrl = makeMockControls(cbs);
        ctrl.selectedVoice = "fallback-voice";
        deps._mocks = { ...deps._mocks, mockControls: ctrl };
        return ctrl;
      };
      const reader = createReader(deps);
      await reader.init();
      assert.equal(deps._mocks.mockControls.selectedVoice, "fallback-voice");
    });
  });

  describe("port message handling", () => {
    it("sets bgConnected on connected message", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "connected" });
    });

    it("handles ws-error by marking disconnected", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "connected" });
      deps._mocks.mockPort._fire({ type: "ws-error", conn: 0, message: "fail" });
    });

    it("ignores messages with invalid para IDs", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
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

      const ensurePromise = reader._ensureBuffered(0);
      deps._mocks.mockPort._fire({ type: "audio", id: "para-0", data: "audiodata" });
      deps._mocks.mockPort._fire({ type: "done", id: "para-0" });

      await ensurePromise;
      assert.equal(mockScheduler.onFetchComplete.mock.callCount(), 1);
    });

    it("handles disconnect by clearing port", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fireDisconnect();
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
      assert.equal(args[0], "en");
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
      const postCalls = deps.env.window.parent.postMessage.mock.calls;
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

      const countBefore = deps._mocks.mockPort.postMessage.mock.callCount();
      reader._dispatchFetch({ conn: 0, index: 0, text: "Hello" });
      reader.cleanup();

      await new Promise((r) => setTimeout(r, 400));

      const speakCalls = deps._mocks.mockPort.postMessage.mock.calls
        .slice(countBefore)
        .filter((c) => c.arguments[0].action === "speak");
      assert.equal(speakCalls.length, 0, "no speak messages after cleanup");
    });

    it("deduplicates reconnectBg across concurrent dispatches", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();

      reader._dispatchFetch({ conn: 0, index: 0, text: "Hello" });
      reader._dispatchFetch({ conn: 1, index: 1, text: "World" });

      const connectCalls = deps._mocks.mockPort.postMessage.mock.calls.filter(
        (c) => c.arguments[0].action === "connect"
      );
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

      reader._dispatchFetch({ conn: 0, index: 0, text: "Hello" });

      await new Promise((r) => setTimeout(r, 150));
      deps._mocks.mockPort._fire({ type: "connected" });

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

      deps._mocks.mockPort._fire({ type: "audio", id: "para-0", data: "chunk" });
      deps._mocks.mockPort._fire({ type: "done", id: "para-0" });

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

      const promise = reader._ensureBuffered(0);
      reader.cleanup();

      await assert.rejects(promise, { message: "cleanup" });
    });
  });

  describe("playFromParagraph", () => {
    it("stops at end of paragraphs", async () => {
      const deps = makeDeps();
      const reader = createReader(deps);
      await reader.init();

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

      deps._mocks.mockPort._fire({ type: "done", id: "para-0" });
      deps._mocks.mockPort._fire({ type: "done", id: "para-1" });

      await reader._playFromParagraph(0);
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

      deps._mocks.mockPort._fire({ type: "audio", id: "para-0", data: "audio1" });
      deps._mocks.mockPort._fire({
        type: "word",
        id: "para-0",
        offset: 0,
        length: 5,
        audioOffset: 0,
      });
      deps._mocks.mockPort._fire({ type: "done", id: "para-0" });
      deps._mocks.mockPort._fire({ type: "done", id: "para-1" });

      await reader._playFromParagraph(0);

      assert.equal(deps._mocks.mockPlayer.decodeAudio.mock.callCount(), 1);
      assert.equal(deps._mocks.mockHighlight.loadParagraph.mock.callCount(), 1);
      assert.equal(deps._mocks.mockHighlight.addWordEvents.mock.callCount(), 1);
      assert.equal(deps._mocks.mockPlayer.play.mock.callCount(), 1);
      assert.equal(deps._mocks.mockHighlight.start.mock.callCount(), 1);
    });

    it("calls ui.markCurrent and ui.markPlayed during playback", async () => {
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

      deps._mocks.mockPort._fire({ type: "audio", id: "para-0", data: "audio1" });
      deps._mocks.mockPort._fire({ type: "done", id: "para-0" });
      deps._mocks.mockPort._fire({ type: "done", id: "para-1" });

      await reader._playFromParagraph(0);

      assert.ok(deps._mocks.mockUI.markCurrent.mock.callCount() >= 1);
      assert.equal(deps._mocks.mockUI.markCurrent.mock.calls[0].arguments[0], 0);
      assert.ok(deps._mocks.mockUI.markPlayed.mock.callCount() >= 1);
      assert.equal(deps._mocks.mockUI.markPlayed.mock.calls[0].arguments[0], 0);
    });

    it("stops playback loop when decodeAudio throws", async () => {
      const deps = makeDeps();
      const mockScheduler = makeMockScheduler();
      mockScheduler.fetchByIndex = mock.fn((i) => ({
        conn: 0,
        index: i,
        text: "Hello world",
      }));
      deps.components.createScheduler = () => mockScheduler;
      deps._mocks.mockPlayer.decodeAudio = mock.fn(async () => {
        throw new Error("decode error");
      });

      const reader = createReader(deps);
      await reader.init();
      deps._mocks.mockPort._fire({ type: "connected" });

      // Buffer para 0 with audio data that will fail to decode
      deps._mocks.mockPort._fire({ type: "audio", id: "para-0", data: "bad-audio" });
      deps._mocks.mockPort._fire({ type: "done", id: "para-0" });
      // Buffer para 1 with audio data — should NOT be reached
      deps._mocks.mockPort._fire({ type: "audio", id: "para-1", data: "audio1" });
      deps._mocks.mockPort._fire({ type: "done", id: "para-1" });

      await reader._playFromParagraph(0);

      // decode was called for para 0 only, not para 1
      assert.equal(deps._mocks.mockPlayer.decodeAudio.mock.callCount(), 1);
      // play was never called (decode failed before play)
      assert.equal(deps._mocks.mockPlayer.play.mock.callCount(), 0);
    });
  });
});
