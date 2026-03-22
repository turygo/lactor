import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { resolveVoice } = await import("./resolve-voice.js");

describe("resolveVoice", () => {
  const voices = [
    { name: "en-US-AriaNeural", locale: "en-US" },
    { name: "zh-CN-XiaoxiaoNeural", locale: "zh-CN" },
    { name: "zh-TW-HsiaoChenNeural", locale: "zh-TW" },
    { name: "ja-JP-NanamiNeural", locale: "ja-JP" },
    { name: "ko-KR-SunHiNeural", locale: "ko-KR" },
    { name: "fr-FR-DeniseNeural", locale: "fr-FR" },
  ];

  // Preferred voice tests
  it("returns preferred voice for 'en' when available", () => {
    assert.equal(resolveVoice("en", voices), "en-US-AriaNeural");
  });

  it("returns preferred voice for 'zh' when available", () => {
    assert.equal(resolveVoice("zh", voices), "zh-CN-XiaoxiaoNeural");
  });

  it("returns preferred voice for 'ja' when available", () => {
    assert.equal(resolveVoice("ja", voices), "ja-JP-NanamiNeural");
  });

  it("returns preferred voice for 'ko' when available", () => {
    assert.equal(resolveVoice("ko", voices), "ko-KR-SunHiNeural");
  });

  // Locale prefix fallback when preferred not in list
  it("falls back to any matching locale voice when preferred not available", () => {
    const limited = [
      { name: "en-GB-SoniaNeural", locale: "en-GB" },
      { name: "zh-CN-YunxiNeural", locale: "zh-CN" },
    ];
    assert.equal(resolveVoice("en", limited), "en-GB-SoniaNeural");
    assert.equal(resolveVoice("zh", limited), "zh-CN-YunxiNeural");
  });

  // Extended BCP-47 tag tests
  it("handles extended tag 'zh-TW' — prefers zh-TW voice", () => {
    assert.equal(resolveVoice("zh-TW", voices), "zh-TW-HsiaoChenNeural");
  });

  it("falls back to any zh- voice when zh-TW not available", () => {
    const noTW = voices.filter((v) => v.locale !== "zh-TW");
    assert.equal(resolveVoice("zh-TW", noTW), "zh-CN-XiaoxiaoNeural");
  });

  // English fallback
  it("falls back to English voice when no match for given lang", () => {
    assert.equal(resolveVoice("de", voices), "en-US-AriaNeural");
  });

  // Ultimate fallback
  it("falls back to first voice when no English voice", () => {
    const noEn = voices.filter((v) => !v.locale.startsWith("en-"));
    assert.equal(resolveVoice("de", noEn), "zh-CN-XiaoxiaoNeural");
  });

  // Null / empty cases
  it("returns null for empty voices array", () => {
    assert.equal(resolveVoice("en", []), null);
  });

  it("returns null for falsy voices", () => {
    assert.equal(resolveVoice("en", null), null);
    assert.equal(resolveVoice("en", undefined), null);
  });

  // Returns name string, not object
  it("returns the voice name string, not the voice object", () => {
    const result = resolveVoice("en", voices);
    assert.equal(typeof result, "string");
  });

  // User preference (3rd argument)
  it("returns user-preferred voice when it exists in the list", () => {
    assert.equal(resolveVoice("en", voices, "fr-FR-DeniseNeural"), "fr-FR-DeniseNeural");
  });

  it("ignores user preference when voice is not in the list (stale pref)", () => {
    assert.equal(resolveVoice("en", voices, "en-US-RemovedNeural"), "en-US-AriaNeural");
  });

  it("ignores empty/null user preference", () => {
    assert.equal(resolveVoice("en", voices, ""), "en-US-AriaNeural");
    assert.equal(resolveVoice("en", voices, null), "en-US-AriaNeural");
  });

  // Regression: user pref overrides even when lang has an extended tag
  it("user pref overrides extended-tag resolution", () => {
    assert.equal(resolveVoice("zh-TW", voices, "zh-CN-XiaoxiaoNeural"), "zh-CN-XiaoxiaoNeural");
  });

  // Regression: stale pref for different language still falls back correctly
  it("stale pref with mismatched lang falls through to lang resolution", () => {
    // User had saved a Japanese voice but voice list changed
    assert.equal(resolveVoice("ja", voices, "ja-JP-RemovedNeural"), "ja-JP-NanamiNeural");
  });

  // Regression: user pref with empty voice list returns null
  it("returns null with user pref but empty voices", () => {
    assert.equal(resolveVoice("en", [], "en-US-AriaNeural"), null);
  });
});
