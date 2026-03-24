import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createPlaybackState } from "./playback-state.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeState(opts = {}) {
  const log = { warn: mock.fn() };
  return { ps: createPlaybackState({ paragraphCount: 5, log, ...opts }), log };
}

// ── Tests ────────────────────────────────────────────────────────

describe("createPlaybackState", () => {
  describe("initial state", () => {
    it("starts in idle with index 0", () => {
      const { ps } = makeState();
      assert.equal(ps.state, "idle");
      assert.equal(ps.currentIndex, 0);
      assert.equal(ps.targetIndex, null);
      assert.equal(ps.isPlaying, false);
    });

    it("exposes current snapshot", () => {
      const { ps } = makeState();
      assert.deepEqual(ps.current, { state: "idle", currentIndex: 0, targetIndex: null });
    });
  });

  describe("valid transitions", () => {
    it("idle --play--> loading", () => {
      const { ps } = makeState();
      assert.equal(ps.transition("play"), true);
      assert.equal(ps.state, "loading");
    });

    it("loading --buffered--> playing", () => {
      const { ps } = makeState();
      ps.transition("play");
      assert.equal(ps.transition("buffered"), true);
      assert.equal(ps.state, "playing");
    });

    it("playing --pause--> paused", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered");
      assert.equal(ps.transition("pause"), true);
      assert.equal(ps.state, "paused");
    });

    it("paused --resume--> playing", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered");
      ps.transition("pause");
      assert.equal(ps.transition("resume"), true);
      assert.equal(ps.state, "playing");
    });

    it("playing --ended--> loading (auto next segment)", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered");
      assert.equal(ps.transition("ended"), true);
      assert.equal(ps.state, "loading");
    });

    it("playing --finished--> idle (last segment)", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered");
      assert.equal(ps.transition("finished"), true);
      assert.equal(ps.state, "idle");
      assert.equal(ps.currentIndex, 0); // reset on finish
    });

    it("playing --cancel--> idle", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered");
      assert.equal(ps.transition("cancel"), true);
      assert.equal(ps.state, "idle");
    });

    it("playing --jump--> loading", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered");
      assert.equal(ps.transition("jump"), true);
      assert.equal(ps.state, "loading");
    });

    it("loading --error--> error", () => {
      const { ps } = makeState();
      ps.transition("play");
      assert.equal(ps.transition("error"), true);
      assert.equal(ps.state, "error");
    });

    it("error --retry--> loading", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("error");
      assert.equal(ps.transition("retry"), true);
      assert.equal(ps.state, "loading");
    });

    it("error --cancel--> idle", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("error");
      assert.equal(ps.transition("cancel"), true);
      assert.equal(ps.state, "idle");
    });

    it("loading --cancel--> idle", () => {
      const { ps } = makeState();
      ps.transition("play");
      assert.equal(ps.transition("cancel"), true);
      assert.equal(ps.state, "idle");
    });

    it("paused --cancel--> idle", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered");
      ps.transition("pause");
      assert.equal(ps.transition("cancel"), true);
      assert.equal(ps.state, "idle");
    });

    it("paused --jump--> loading", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered");
      ps.transition("pause");
      assert.equal(ps.transition("jump"), true);
      assert.equal(ps.state, "loading");
    });
  });

  describe("invalid transitions", () => {
    it("idle --pause--> ignored, stays idle", () => {
      const { ps, log } = makeState();
      assert.equal(ps.transition("pause"), false);
      assert.equal(ps.state, "idle");
      assert.equal(log.warn.mock.callCount(), 1);
    });

    it("idle --resume--> ignored", () => {
      const { ps } = makeState();
      assert.equal(ps.transition("resume"), false);
      assert.equal(ps.state, "idle");
    });

    it("loading --pause--> ignored", () => {
      const { ps } = makeState();
      ps.transition("play");
      assert.equal(ps.transition("pause"), false);
      assert.equal(ps.state, "loading");
    });

    it("playing --play--> ignored", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered");
      assert.equal(ps.transition("play"), false);
      assert.equal(ps.state, "playing");
    });

    it("error --pause--> ignored", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("error");
      assert.equal(ps.transition("pause"), false);
      assert.equal(ps.state, "error");
    });
  });

  describe("stateChange events", () => {
    it("fires stateChange on valid transition", () => {
      const { ps } = makeState();
      const events = [];
      ps.on("stateChange", (e) => events.push(e));

      ps.transition("play");

      assert.equal(events.length, 1);
      assert.equal(events[0].from, "idle");
      assert.equal(events[0].to, "loading");
      assert.equal(events[0].event, "play");
    });

    it("does not fire stateChange on invalid transition", () => {
      const { ps } = makeState();
      const events = [];
      ps.on("stateChange", (e) => events.push(e));

      ps.transition("pause"); // invalid from idle

      assert.equal(events.length, 0);
    });

    it("supports unsubscribe", () => {
      const { ps } = makeState();
      const events = [];
      const unsub = ps.on("stateChange", (e) => events.push(e));

      ps.transition("play");
      unsub();
      ps.transition("buffered");

      assert.equal(events.length, 1); // only first event
    });

    it("supports multiple listeners", () => {
      const { ps } = makeState();
      const a = [], b = [];
      ps.on("stateChange", (e) => a.push(e));
      ps.on("stateChange", (e) => b.push(e));

      ps.transition("play");

      assert.equal(a.length, 1);
      assert.equal(b.length, 1);
    });
  });

  describe("goTo", () => {
    it("from idle: transitions to loading with targetIndex", () => {
      const { ps } = makeState();
      const events = [];
      ps.on("stateChange", (e) => events.push(e));

      assert.equal(ps.goTo(3), true);
      assert.equal(ps.state, "loading");
      assert.equal(ps.targetIndex, 3);
      assert.equal(events[0].to, "loading");
    });

    it("from playing: triggers jump to loading", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered");

      assert.equal(ps.goTo(2), true);
      assert.equal(ps.state, "loading");
      assert.equal(ps.targetIndex, 2);
    });

    it("from paused: triggers jump to loading", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered");
      ps.transition("pause");

      assert.equal(ps.goTo(4), true);
      assert.equal(ps.state, "loading");
      assert.equal(ps.targetIndex, 4);
    });

    it("from loading: retargets without state change", () => {
      const { ps } = makeState();
      ps.transition("play");
      const events = [];
      ps.on("stateChange", (e) => events.push(e));

      assert.equal(ps.goTo(3), true);
      assert.equal(ps.state, "loading"); // stays loading
      assert.equal(ps.targetIndex, 3);
      assert.equal(events[0].event, "retarget");
    });

    it("rejects out-of-range index", () => {
      const { ps, log } = makeState();
      assert.equal(ps.goTo(-1), false);
      assert.equal(ps.goTo(5), false); // paragraphCount is 5, max valid is 4
      assert.equal(log.warn.mock.callCount(), 2);
    });

    it("rejects from error state", () => {
      const { ps, log } = makeState();
      ps.transition("play");
      ps.transition("error");

      assert.equal(ps.goTo(2), false);
      assert.equal(log.warn.mock.callCount(), 1);
    });
  });

  describe("advanceIndex", () => {
    it("increments currentIndex sequentially", () => {
      const { ps } = makeState();
      ps.transition("play");

      assert.equal(ps.advanceIndex(), true); // 0 → 1
      assert.equal(ps.currentIndex, 1);
      assert.equal(ps.advanceIndex(), true); // 1 → 2
      assert.equal(ps.currentIndex, 2);
    });

    it("uses targetIndex when set", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered");
      ps.goTo(3); // sets targetIndex=3, state→loading

      assert.equal(ps.advanceIndex(), true);
      assert.equal(ps.currentIndex, 3);
      assert.equal(ps.targetIndex, null); // consumed
    });

    it("returns false when past last paragraph", () => {
      const { ps } = makeState({ paragraphCount: 2 });
      ps.transition("play");

      ps.advanceIndex(); // 0 → 1
      assert.equal(ps.advanceIndex(), false); // 1 → 2 (out of range)
    });

    it("fires segmentChange event", () => {
      const { ps } = makeState();
      const events = [];
      ps.on("segmentChange", (e) => events.push(e));

      ps.advanceIndex();

      assert.equal(events.length, 1);
      assert.equal(events[0].index, 1);
    });
  });

  describe("paragraphCount setter", () => {
    it("allows updating paragraph count after creation", () => {
      const { ps } = makeState({ paragraphCount: 0 });
      assert.equal(ps.paragraphCount, 0);
      ps.paragraphCount = 10;
      assert.equal(ps.paragraphCount, 10);
    });
  });

  describe("full playback cycle", () => {
    it("plays through all segments sequentially", () => {
      const { ps } = makeState({ paragraphCount: 3 });
      const states = [];
      ps.on("stateChange", (e) => states.push(`${e.from}->${e.to}`));

      // Segment 0
      ps.transition("play");     // idle → loading
      ps.transition("buffered"); // loading → playing
      ps.transition("ended");    // playing → loading (auto next)
      ps.advanceIndex();         // 0 → 1

      // Segment 1
      ps.transition("buffered"); // loading → playing
      ps.transition("ended");    // playing → loading
      ps.advanceIndex();         // 1 → 2

      // Segment 2 (last)
      ps.transition("buffered"); // loading → playing
      ps.transition("finished"); // playing → idle

      assert.deepEqual(states, [
        "idle->loading",
        "loading->playing",
        "playing->loading",
        "loading->playing",
        "playing->loading",
        "loading->playing",
        "playing->idle",
      ]);
      assert.equal(ps.state, "idle");
    });

    it("handles pause/resume mid-playback", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered"); // playing

      ps.transition("pause");    // paused
      assert.equal(ps.state, "paused");

      ps.transition("resume");   // playing
      assert.equal(ps.state, "playing");
    });

    it("handles jump during playback", () => {
      const { ps } = makeState();
      ps.transition("play");
      ps.transition("buffered"); // playing segment 0

      ps.goTo(3);                // jump → loading, target=3
      assert.equal(ps.state, "loading");

      ps.advanceIndex();         // currentIndex = 3 (from target)
      assert.equal(ps.currentIndex, 3);

      ps.transition("buffered"); // loading → playing
      assert.equal(ps.state, "playing");
    });
  });
});
