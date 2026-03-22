/**
 * Voice preferences: persist user's voice choice per language.
 */

export const PREFS_KEY = "voicePrefs";

/**
 * Load stored voice preferences.
 * @param {object} storage - browser.storage.local
 * @returns {Promise<Record<string, string>>} Map of lang → voiceName
 */
export async function loadVoicePrefs(storage) {
  try {
    const result = await storage.get(PREFS_KEY);
    return result[PREFS_KEY] || {};
  } catch {
    return {};
  }
}

/**
 * Save a voice preference for a language.
 * @param {string} lang - Primary language code (e.g. "en", "zh")
 * @param {string} voiceName - Selected voice name
 * @param {object} storage - browser.storage.local
 */
export async function saveVoicePref(lang, voiceName, storage) {
  try {
    const prefs = await loadVoicePrefs(storage);
    prefs[lang] = voiceName;
    await storage.set({ [PREFS_KEY]: prefs });
  } catch {
    // non-fatal
  }
}
