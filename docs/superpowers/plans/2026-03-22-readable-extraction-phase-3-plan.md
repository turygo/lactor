# Readable Extraction Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve voice-loading experience and preference persistence after Phases 1 and 2 are stable.

**Architecture:** Add storage-backed voice cache and per-language preferences around the existing reader flow. Treat backend `/voices` adjustments as optional and strictly in support of front-end needs.

**Tech Stack:** ES modules, `browser.storage.local`, existing FastAPI `/voices` endpoint, Node.js `node --test`, Python tests if backend changes are made.

---

## File Structure

### Possible New Files

| File | Responsibility |
|------|----------------|
| `extension/reader/components/voice-cache.js` | Small helper for cache read/write and expiry |
| `extension/reader/components/voice-cache.test.js` | Cache behavior tests |

### Modified Files

| File | Changes |
|------|---------|
| `extension/reader/reader.js` | Load cached voices and persist preferences |
| `extension/reader/components/controls.js` | Reflect cached/default/selected voice state |
| `src/lactor/main.py` | Optional `/voices` filtering or response cleanup |

## Task 1: Add Voice Cache

**Files:**
- Modify: `extension/reader/reader.js`
- Create or Modify: `extension/reader/components/voice-cache.js`

- [ ] **Step 1: Define cache shape and expiry policy**
- [ ] **Step 2: Load cache before network voice fetch**
- [ ] **Step 3: Keep UI usable even when cache is empty**
- [ ] **Step 4: Write and run cache tests**
- [ ] **Step 5: Commit**

## Task 2: Persist User Preferences

**Files:**
- Modify: `extension/reader/reader.js`
- Modify: `extension/reader/components/controls.js`
- Modify: `extension/reader/components/resolve-voice.js`

- [ ] **Step 1: Save selected voice per language in `browser.storage.local`**
- [ ] **Step 2: Extend `resolveVoice()` to prefer stored selection**
- [ ] **Step 3: Handle missing or stale voices with deterministic fallback**
- [ ] **Step 4: Run JS tests**
- [ ] **Step 5: Commit**

## Task 3: Evaluate Optional `/voices` API Cleanup

**Files:**
- Modify: `src/lactor/main.py` only if justified by front-end complexity

- [ ] **Step 1: Confirm whether front-end still needs API cleanup after cache/prefs are implemented**
- [ ] **Step 2: If needed, add the smallest viable change such as `lang` filtering**
- [ ] **Step 3: Keep backward compatibility or update the reader in the same change**
- [ ] **Step 4: Run Python and JS tests if backend changes land**
- [ ] **Step 5: Commit**

## Task 4: Add Regression Coverage

**Files:**
- Modify: existing Phase 1 and Phase 2 test files
- Add: a small number of extra fixtures if gaps remain

- [ ] **Step 1: Add regressions for cached voices, stale preferences, and fallback behavior**
- [ ] **Step 2: Add only a few high-value fixtures instead of a large benchmark corpus**
- [ ] **Step 3: Run full relevant test suites**
- [ ] **Step 4: Commit**

## Done Criteria

- Reader can start with cached voice data when available
- Voice choice persists by language
- Failures in cache or voice refresh do not block playback
- Backend API changes remain optional and minimal
