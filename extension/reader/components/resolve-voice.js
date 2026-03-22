/**
 * Resolve the best default voice name for a given language.
 *
 * @param {string} lang - Language code ("en", "zh", "zh-TW", "ja", "ko", …)
 * @param {Array<{name: string, locale: string}>} voices - Voice list from /voices endpoint
 * @returns {string|null} Voice name string, or null if voices is empty/falsy
 */

const PREFERRED = {
  en: "en-US-AriaNeural",
  zh: "zh-CN-XiaoxiaoNeural",
  ja: "ja-JP-NanamiNeural",
  ko: "ko-KR-SunHiNeural",
};

export function resolveVoice(lang, voices) {
  if (!voices || voices.length === 0) return null;

  // Derive the primary language tag (e.g. "zh" from "zh-TW")
  const primaryLang = lang.split("-")[0];

  // 1. Extended tag match: if lang has a subtag (e.g. "zh-TW"), try exact prefix first
  //    This takes priority over the preferred voice for the primary language.
  if (lang.includes("-")) {
    const exactMatch = voices.find((v) => v.locale.startsWith(lang));
    if (exactMatch) return exactMatch.name;
  }

  // 2. Check preferred voice for the primary language
  const preferred = PREFERRED[primaryLang];
  if (preferred) {
    const found = voices.find((v) => v.name === preferred);
    if (found) return found.name;
  }

  // 3. Primary language prefix match (e.g. "zh-" for lang="zh" or lang="zh-TW" fallback)
  const langPrefix = primaryLang + "-";
  const langMatch = voices.find((v) => v.locale.startsWith(langPrefix));
  if (langMatch) return langMatch.name;

  // 4. English fallback
  const enMatch = voices.find((v) => v.locale.startsWith("en-"));
  if (enMatch) return enMatch.name;

  // 5. Ultimate fallback
  return voices[0].name;
}
