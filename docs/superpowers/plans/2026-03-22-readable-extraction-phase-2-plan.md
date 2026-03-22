# Readable Extraction Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight language-aware placeholders and default voice resolution without introducing cache or backend API churn.

**Architecture:** Extend Phase 1 output with `lang`, keep voice resolution outside the content pipeline, and reuse the existing `/voices` response shape to minimize coupling.

**Tech Stack:** ES modules, browser storage/message APIs already in use, existing `/voices` endpoint, Node.js `node --test`.

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `extension/reader/components/resolve-voice.js` | Choose a default voice from language + voice list |
| `extension/reader/components/resolve-voice.test.js` | Voice resolution tests |

### Modified Files

| File | Changes |
|------|---------|
| `extension/content/extractor.js` | Include page `lang` in extracted payload |
| `extension/reader/components/pipeline/structure.js` | Generate localized placeholders |
| `extension/reader/reader.js` | Read `lang`, call `resolveVoice()`, keep init non-blocking |
| `extension/reader/components/controls.js` | Minimal support for externally selected default voice |

## Task 1: Pass Language Through Extraction

**Files:**
- Modify: `extension/content/extractor.js`
- Modify: `extension/background.js` if passthrough changes are required

- [ ] **Step 1: Add `document.documentElement.lang || \"\"` to extracted content payload**
- [ ] **Step 2: Verify background still passes content through unchanged**
- [ ] **Step 3: Manual check that reader receives `resp.data.lang`**
- [ ] **Step 4: Commit**

## Task 2: Add Lightweight Language Resolution

**Files:**
- Modify: `extension/reader/components/pipeline/structure.js`
- Test: `extension/reader/components/pipeline/structure.test.js` or a dedicated language test

- [ ] **Step 1: Prefer payload `lang` when present**
- [ ] **Step 2: Add minimal heuristics for `zh / ja / ko / en` when `lang` is absent**
- [ ] **Step 3: Localize non-text placeholders from resolved language**
- [ ] **Step 4: Run relevant Node tests**
- [ ] **Step 5: Commit**

## Task 3: Add `resolveVoice(lang, voices)`

**Files:**
- Create: `extension/reader/components/resolve-voice.js`
- Test: `extension/reader/components/resolve-voice.test.js`

- [ ] **Step 1: Write tests for default mapping, locale prefix fallback, and English fallback**
- [ ] **Step 2: Implement the minimal resolver**
- [ ] **Step 3: Keep compatibility with current `/voices` response shape using `v.name`**
- [ ] **Step 4: Run `node --test extension/reader/components/resolve-voice.test.js`**
- [ ] **Step 5: Commit**

## Task 4: Integrate Voice Resolution Into Reader

**Files:**
- Modify: `extension/reader/reader.js`
- Modify: `extension/reader/components/controls.js`

- [ ] **Step 1: Load voices as today**
- [ ] **Step 2: After content processing, choose a default voice with `resolveVoice()`**
- [ ] **Step 3: Ensure manual voice selection still overrides for the current session**
- [ ] **Step 4: Run JS tests and one multilingual manual smoke test**
- [ ] **Step 5: Commit**

## Done Criteria

- Reader can choose a better default voice for common languages
- Placeholder language follows article language
- No voice cache or backend API redesign is introduced
