import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { loadVoicePrefs, saveVoicePref, PREFS_KEY } = await import("./voice-prefs.js");

describe("voice-prefs", () => {
  describe("loadVoicePrefs", () => {
    it("returns stored prefs object", async () => {
      const storage = {
        get: async () => ({ [PREFS_KEY]: { en: "en-US-GuyNeural" } }),
      };
      const prefs = await loadVoicePrefs(storage);
      assert.deepEqual(prefs, { en: "en-US-GuyNeural" });
    });

    it("returns empty object when no prefs stored", async () => {
      const storage = { get: async () => ({}) };
      assert.deepEqual(await loadVoicePrefs(storage), {});
    });

    it("returns empty object when storage throws", async () => {
      const storage = {
        get: async () => {
          throw new Error("fail");
        },
      };
      assert.deepEqual(await loadVoicePrefs(storage), {});
    });
  });

  describe("saveVoicePref", () => {
    it("merges new language pref into existing prefs", async () => {
      const existing = { en: "en-US-AriaNeural" };
      let stored = null;
      const storage = {
        get: async () => ({ [PREFS_KEY]: existing }),
        set: async (data) => {
          stored = data;
        },
      };
      await saveVoicePref("zh", "zh-CN-YunxiNeural", storage);
      assert.deepEqual(stored[PREFS_KEY], {
        en: "en-US-AriaNeural",
        zh: "zh-CN-YunxiNeural",
      });
    });

    it("overwrites existing pref for same language", async () => {
      let stored = null;
      const storage = {
        get: async () => ({ [PREFS_KEY]: { en: "en-US-AriaNeural" } }),
        set: async (data) => {
          stored = data;
        },
      };
      await saveVoicePref("en", "en-US-GuyNeural", storage);
      assert.equal(stored[PREFS_KEY].en, "en-US-GuyNeural");
    });

    it("creates prefs object when none exists", async () => {
      let stored = null;
      const storage = {
        get: async () => ({}),
        set: async (data) => {
          stored = data;
        },
      };
      await saveVoicePref("ja", "ja-JP-NanamiNeural", storage);
      assert.deepEqual(stored[PREFS_KEY], { ja: "ja-JP-NanamiNeural" });
    });

    it("does not throw when storage fails", async () => {
      const storage = {
        get: async () => ({}),
        set: async () => {
          throw new Error("quota");
        },
      };
      await assert.doesNotReject(() => saveVoicePref("en", "en-US-AriaNeural", storage));
    });
  });

  describe("round-trip regression", () => {
    it("saves and loads multiple language prefs independently", async () => {
      const store = {};
      const storage = {
        get: async (key) => ({ [key]: store[key] }),
        set: async (data) => Object.assign(store, data),
      };
      await saveVoicePref("en", "en-US-GuyNeural", storage);
      await saveVoicePref("zh", "zh-CN-YunxiNeural", storage);
      await saveVoicePref("en", "en-US-AriaNeural", storage); // overwrite
      const prefs = await loadVoicePrefs(storage);
      assert.equal(prefs.en, "en-US-AriaNeural");
      assert.equal(prefs.zh, "zh-CN-YunxiNeural");
    });
  });
});
