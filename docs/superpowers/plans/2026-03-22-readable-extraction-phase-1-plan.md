# Readable Extraction Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce readable noise and render typed segments without destabilizing the current playback pipeline.

**Architecture:** Introduce a small content pipeline for `sanitize -> structure`, then render the resulting segments through a dedicated renderer. Keep TTS, scheduler, player, and buffering logic consuming `string[]` derived from `segments.map((s) => s.text)`.

**Tech Stack:** ES modules, DOMParser, Node.js `node --test`, existing reader/player/highlight modules.

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `extension/reader/components/pipeline/index.js` | Minimal pipeline runner |
| `extension/reader/components/pipeline/sanitize.js` | High-confidence DOM noise removal |
| `extension/reader/components/pipeline/structure.js` | DOM to typed segments |
| `extension/reader/components/render-segments.js` | Render `text` and non-text segments |
| `extension/reader/components/pipeline/sanitize.test.js` | Sanitize tests |
| `extension/reader/components/pipeline/structure.test.js` | Structure tests |
| `extension/reader/components/render-segments.test.js` | Segment rendering tests |

### Modified Files

| File | Changes |
|------|---------|
| `extension/reader/reader.js` | Replace direct paragraph split/render with pipeline + segment rendering |
| `extension/reader/components/normalizer.js` | Retain shared text helpers; remove direct HTML-to-paragraph rendering responsibilities |
| `extension/reader/components/highlight.js` | Support `[data-para]` and whole-segment highlight |
| `extension/reader/reader.css` | Add non-text segment styling |

## Task 1: Add Minimal Pipeline Runner

**Files:**
- Create: `extension/reader/components/pipeline/index.js`

- [ ] **Step 1: Add `createPipeline(stages)`**
- [ ] **Step 2: Keep the contract minimal: parse HTML, build context, run stages in order**
- [ ] **Step 3: Verify the module loads in Node or browser context**
- [ ] **Step 4: Commit**

## Task 2: Implement Sanitize Stage

**Files:**
- Create: `extension/reader/components/pipeline/sanitize.js`
- Test: `extension/reader/components/pipeline/sanitize.test.js`

- [ ] **Step 1: Write tests for semantic noise removal**
- [ ] **Step 2: Write tests for lightweight content scoring**
- [ ] **Step 3: Implement `sanitize(context)` with conservative thresholds**
- [ ] **Step 4: Run `node --test extension/reader/components/pipeline/sanitize.test.js`**
- [ ] **Step 5: Commit**

## Task 3: Implement Structure Stage

**Files:**
- Create: `extension/reader/components/pipeline/structure.js`
- Test: `extension/reader/components/pipeline/structure.test.js`

- [ ] **Step 1: Write tests for `text / code / table / image / formula` classification**
- [ ] **Step 2: Implement recursive DOM collection**
- [ ] **Step 3: Ensure output shape stays minimal: `{ type, text, html }`**
- [ ] **Step 4: Run `node --test extension/reader/components/pipeline/structure.test.js`**
- [ ] **Step 5: Commit**

## Task 4: Render Typed Segments

**Files:**
- Create: `extension/reader/components/render-segments.js`
- Test: `extension/reader/components/render-segments.test.js`

- [ ] **Step 1: Write rendering tests for mixed segment types**
- [ ] **Step 2: Render `text` segments as word spans**
- [ ] **Step 3: Render non-text segments as block containers with `data-segment-type`**
- [ ] **Step 4: Run `node --test extension/reader/components/render-segments.test.js`**
- [ ] **Step 5: Commit**

## Task 5: Rewire Reader and Highlight

**Files:**
- Modify: `extension/reader/reader.js`
- Modify: `extension/reader/components/highlight.js`
- Modify: `extension/reader/components/normalizer.js`
- Modify: `extension/reader/reader.css`

- [ ] **Step 1: Replace `splitIntoParagraphs()` + `renderParagraphs()` with pipeline + `renderSegments()`**
- [ ] **Step 2: Keep `paragraphs = segments.map((segment) => segment.text)` for scheduler compatibility**
- [ ] **Step 3: Update highlight selectors from `p[data-para]` to `[data-para]`**
- [ ] **Step 4: Add whole-segment highlight behavior for non-text segments**
- [ ] **Step 5: Run existing JS tests and new Phase 1 tests**
- [ ] **Step 6: Manual smoke test on at least one article page**
- [ ] **Step 7: Commit**

## Done Criteria

- Reader shows cleaner content than current implementation
- Typed segments render correctly
- Existing playback and prefetch behavior still works
- No Phase 2 or Phase 3 work is included in this branch
