/**
 * Voice cache: persist /voices response in browser.storage.local with TTL.
 */

export const CACHE_KEY = "voiceCache";
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function makeCacheEntry(voices) {
  return { voices, cachedAt: Date.now() };
}

export function isExpired(entry, now = Date.now()) {
  if (!entry || typeof entry.cachedAt !== "number") return true;
  return now - entry.cachedAt > CACHE_TTL_MS;
}

/**
 * Load cached voices from storage. Returns the voice array or null.
 * @param {object} storage - storage backend (default: browser.storage.local)
 */
export async function loadCachedVoices(storage) {
  try {
    const result = await storage.get(CACHE_KEY);
    const entry = result[CACHE_KEY];
    if (!entry || isExpired(entry)) return null;
    return entry.voices;
  } catch {
    return null;
  }
}

/**
 * Write voices to cache. Silently swallows errors.
 * @param {Array} voices - voice list to cache
 * @param {object} storage - storage backend (default: browser.storage.local)
 */
export async function cacheVoices(voices, storage) {
  try {
    await storage.set({ [CACHE_KEY]: makeCacheEntry(voices) });
  } catch {
    // quota exceeded or other storage errors — non-fatal
  }
}
