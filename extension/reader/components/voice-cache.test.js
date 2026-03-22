import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { isExpired, makeCacheEntry, loadCachedVoices, cacheVoices, CACHE_TTL_MS } =
  await import("./voice-cache.js");

const voices = [
  { name: "en-US-AriaNeural", locale: "en-US" },
  { name: "zh-CN-XiaoxiaoNeural", locale: "zh-CN" },
];

describe("makeCacheEntry", () => {
  it("wraps voices with a cachedAt timestamp", () => {
    const before = Date.now();
    const entry = makeCacheEntry(voices);
    const after = Date.now();
    assert.deepEqual(entry.voices, voices);
    assert.ok(entry.cachedAt >= before && entry.cachedAt <= after);
  });
});

describe("isExpired", () => {
  it("returns true for null entry", () => {
    assert.equal(isExpired(null), true);
  });

  it("returns true for entry without cachedAt", () => {
    assert.equal(isExpired({ voices }), true);
  });

  it("returns false for fresh entry", () => {
    const entry = makeCacheEntry(voices);
    assert.equal(isExpired(entry), false);
  });

  it("returns true for entry older than TTL", () => {
    const entry = { voices, cachedAt: Date.now() - CACHE_TTL_MS - 1 };
    assert.equal(isExpired(entry), true);
  });

  it("returns false for entry exactly at TTL boundary", () => {
    const now = Date.now();
    const entry = { voices, cachedAt: now - CACHE_TTL_MS };
    assert.equal(isExpired(entry, now), false);
  });

  it("accepts custom now parameter", () => {
    const entry = { voices, cachedAt: 1000 };
    assert.equal(isExpired(entry, 1000 + CACHE_TTL_MS), false);
    assert.equal(isExpired(entry, 1000 + CACHE_TTL_MS + 1), true);
  });
});

describe("loadCachedVoices", () => {
  it("returns voices from fresh cache", async () => {
    const storage = {
      get: async () => ({ voiceCache: makeCacheEntry(voices) }),
    };
    const result = await loadCachedVoices(storage);
    assert.deepEqual(result, voices);
  });

  it("returns null for expired cache", async () => {
    const old = { voices, cachedAt: Date.now() - CACHE_TTL_MS - 1 };
    const storage = { get: async () => ({ voiceCache: old }) };
    assert.equal(await loadCachedVoices(storage), null);
  });

  it("returns null when cache key is missing", async () => {
    const storage = { get: async () => ({}) };
    assert.equal(await loadCachedVoices(storage), null);
  });

  it("returns null when storage throws", async () => {
    const storage = {
      get: async () => {
        throw new Error("storage error");
      },
    };
    assert.equal(await loadCachedVoices(storage), null);
  });
});

describe("cacheVoices", () => {
  it("writes cache entry to storage", async () => {
    let stored = null;
    const storage = {
      set: async (data) => {
        stored = data;
      },
    };
    await cacheVoices(voices, storage);
    assert.ok(stored.voiceCache);
    assert.deepEqual(stored.voiceCache.voices, voices);
    assert.equal(typeof stored.voiceCache.cachedAt, "number");
  });

  it("does not throw when storage fails", async () => {
    const storage = {
      set: async () => {
        throw new Error("quota exceeded");
      },
    };
    await assert.doesNotReject(() => cacheVoices(voices, storage));
  });
});
