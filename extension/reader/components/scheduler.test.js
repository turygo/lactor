import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MetricsTracker, PrefetchScheduler } from "./scheduler.js";

// ── MetricsTracker ──────────────────────────────────────────────

describe("MetricsTracker", () => {
  it("returns default rate when no samples recorded", () => {
    const m = new MetricsTracker();
    assert.equal(m.getRate(), 10); // 10 ms/char default
  });

  it("computes rate from a single sample", () => {
    const m = new MetricsTracker();
    m.record(100, 500); // 100 chars, 500ms → 5 ms/char
    assert.equal(m.getRate(), 5);
  });

  it("computes sliding average over multiple samples", () => {
    const m = new MetricsTracker();
    m.record(100, 600); // 6 ms/char
    m.record(200, 800); // 4 ms/char
    assert.equal(m.getRate(), 5); // average of 6 and 4
  });

  it("keeps only last 5 samples (sliding window)", () => {
    const m = new MetricsTracker();
    // Fill 5 samples at 10 ms/char
    for (let i = 0; i < 5; i++) m.record(100, 1000);
    assert.equal(m.getRate(), 10);

    // Add a 6th sample at 5 ms/char — oldest should be evicted
    m.record(100, 500);
    // Window: [10, 10, 10, 10, 5] → average = 9
    assert.equal(m.getRate(), 9);
  });

  it("estimates generation time for a given char count", () => {
    const m = new MetricsTracker();
    m.record(100, 700); // 7 ms/char
    assert.equal(m.estimateGenTime(200), 1400); // 200 * 7
  });

  it("uses default rate for estimation when no samples", () => {
    const m = new MetricsTracker();
    assert.equal(m.estimateGenTime(100), 1000); // 100 * 10
  });
});

// ── PrefetchScheduler ───────────────────────────────────────────

describe("PrefetchScheduler", () => {
  const makeParagraphs = (...lengths) => lengths.map((n) => "x".repeat(n));

  describe("shouldPrefetch", () => {
    it("always prefetches when no in-flight and no buffered (cold start)", () => {
      const s = new PrefetchScheduler(makeParagraphs(50, 50, 50), 3);
      assert.equal(s.shouldPrefetch(Infinity), true);
    });

    it("does not prefetch when in-flight + buffered >= max cap", () => {
      const s = new PrefetchScheduler(makeParagraphs(50, 50, 50, 50, 50), 3);
      // 2 in-flight + 1 buffered = 3 >= cap
      s.getNextFetch(); // in-flight on conn 0
      s.getNextFetch(); // in-flight on conn 1
      s._bufferedCount = 1;
      assert.equal(s.shouldPrefetch(5000), false);
    });

    it("does not prefetch when both connections are busy", () => {
      const s = new PrefetchScheduler(makeParagraphs(50, 50, 50, 50), 3);
      s.getNextFetch(); // conn 0 busy
      s.getNextFetch(); // conn 1 busy
      // Both connections are in-flight — can't dispatch even if cap allows
      assert.equal(s.shouldPrefetch(0), false);
    });

    it("does not prefetch when all paragraphs already fetched", () => {
      const s = new PrefetchScheduler(makeParagraphs(50), 3);
      s._nextFetchIndex = 1; // past end
      assert.equal(s.shouldPrefetch(1000), false);
    });

    it("prefetches when estimated gen time exceeds 80% of remaining playback", () => {
      const s = new PrefetchScheduler(makeParagraphs(10, 200), 3);
      s.metrics.record(100, 1000); // 10 ms/char
      s._nextFetchIndex = 1; // next is 200 chars → est 2000ms
      // remaining = 2000ms, 80% = 1600ms, est = 2000 > 1600 → prefetch
      assert.equal(s.shouldPrefetch(2000), true);
    });

    it("does not prefetch when plenty of playback time remains", () => {
      const s = new PrefetchScheduler(makeParagraphs(10, 20), 3);
      s.metrics.record(100, 500); // 5 ms/char
      s._nextFetchIndex = 1; // next is 20 chars → est 100ms
      s._bufferedCount = 1;
      // remaining = 10000ms, 80% = 8000, est = 100 < 8000 → no prefetch
      assert.equal(s.shouldPrefetch(10000), false);
    });

    it("allows prefetch after a connection becomes free", () => {
      const s = new PrefetchScheduler(makeParagraphs(50, 50, 50), 3);
      s.getNextFetch(); // conn 0 busy, para 0
      s.getNextFetch(); // conn 1 busy, para 1
      // Both busy → can't prefetch
      assert.equal(s.shouldPrefetch(0), false);
      // Para 0 completes → conn 0 free
      s._fetchStartTimes.set(0, Date.now() - 100);
      s.onFetchComplete(0);
      // Now should allow prefetch (conn 0 is free, cap not hit)
      assert.equal(s.shouldPrefetch(0), true);
    });
  });

  describe("getNextFetch", () => {
    it("returns paragraphs in order with alternating connections", () => {
      const s = new PrefetchScheduler(makeParagraphs(10, 20, 30, 40), 3);
      const f0 = s.getNextFetch();
      assert.deepEqual(f0, { conn: 0, index: 0, text: "x".repeat(10) });
      const f1 = s.getNextFetch();
      assert.deepEqual(f1, { conn: 1, index: 1, text: "x".repeat(20) });
      // Both connections busy — should return null
      assert.equal(s.getNextFetch(), null);
      // Complete para 0 → conn 0 free
      s._fetchStartTimes.set(0, Date.now() - 100);
      s.onFetchComplete(0);
      const f2 = s.getNextFetch();
      assert.deepEqual(f2, { conn: 0, index: 2, text: "x".repeat(30) });
    });

    it("returns null when all paragraphs have been dispatched", () => {
      const s = new PrefetchScheduler(makeParagraphs(10), 3);
      s.getNextFetch(); // para 0
      assert.equal(s.getNextFetch(), null);
    });

    it("records fetch start time", () => {
      const s = new PrefetchScheduler(makeParagraphs(10, 20), 3);
      const before = Date.now();
      s.getNextFetch();
      const after = Date.now();
      const startTime = s._fetchStartTimes.get(0);
      assert.ok(startTime >= before && startTime <= after);
    });
  });

  describe("onFetchComplete", () => {
    it("records metrics from generation timing", () => {
      const s = new PrefetchScheduler(makeParagraphs(100), 3);
      s.getNextFetch();
      s._fetchStartTimes.set(0, Date.now() - 500);
      s.onFetchComplete(0);
      const rate = s.metrics.getRate();
      assert.ok(rate > 3 && rate < 8, `Rate should be ~5, got ${rate}`);
    });

    it("increments buffered count", () => {
      const s = new PrefetchScheduler(makeParagraphs(10, 20), 3);
      s.getNextFetch();
      s._fetchStartTimes.set(0, Date.now() - 100);
      s.onFetchComplete(0);
      assert.equal(s._bufferedCount, 1);
    });

    it("frees the connection for reuse", () => {
      const s = new PrefetchScheduler(makeParagraphs(10, 20, 30), 3);
      s.getNextFetch(); // conn 0, para 0
      s.getNextFetch(); // conn 1, para 1
      // Both busy
      assert.equal(s.getNextFetch(), null);
      // Complete para 0 → conn 0 should be free
      s._fetchStartTimes.set(0, Date.now() - 100);
      s.onFetchComplete(0);
      const f = s.getNextFetch();
      assert.equal(f.conn, 0); // reuses conn 0
      assert.equal(f.index, 2);
    });

    it("cleans up fetch start time entry", () => {
      const s = new PrefetchScheduler(makeParagraphs(10), 3);
      s.getNextFetch();
      s._fetchStartTimes.set(0, Date.now() - 100);
      s.onFetchComplete(0);
      assert.equal(s._fetchStartTimes.has(0), false);
    });
  });

  describe("onPlaybackComplete", () => {
    it("decrements buffered count", () => {
      const s = new PrefetchScheduler(makeParagraphs(10, 20), 3);
      s._bufferedCount = 2;
      s.onPlaybackComplete();
      assert.equal(s._bufferedCount, 1);
    });

    it("does not go below zero", () => {
      const s = new PrefetchScheduler(makeParagraphs(10), 3);
      s._bufferedCount = 0;
      s.onPlaybackComplete();
      assert.equal(s._bufferedCount, 0);
    });
  });
});
