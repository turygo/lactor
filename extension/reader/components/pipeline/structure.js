/**
 * Structure stage — walks the DOM tree and produces typed segments.
 *
 * Uses an "inverted whitelist" approach: instead of hardcoding which tags
 * produce text and which are containers, we define a small set of INLINE_TAGS
 * (stable HTML spec defaults). Any element NOT inline is treated as block.
 *
 * Block elements are classified via the "leaf block" heuristic:
 *   - No block-level children → leaf block → extract text
 *   - Has block-level children → container → recurse
 *
 * Special rendering types (pre, table, img, formula) are the only hardcoded
 * tag checks — they are genuinely semantically different.
 *
 * Each segment: { type: "text"|"code"|"table"|"image"|"formula", text, html }
 */

// HTML spec default inline elements.
const INLINE_TAGS = new Set([
  "A",
  "ABBR",
  "ACRONYM",
  "B",
  "BDO",
  "BIG",
  "BR",
  "BUTTON",
  "CITE",
  "CODE",
  "DFN",
  "EM",
  "I",
  "IMG",
  "INPUT",
  "KBD",
  "LABEL",
  "MAP",
  "MARK",
  "OBJECT",
  "OUTPUT",
  "Q",
  "RUBY",
  "RT",
  "RP",
  "S",
  "SAMP",
  "SELECT",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TEXTAREA",
  "TIME",
  "TT",
  "U",
  "VAR",
  "WBR",
]);

/**
 * Localized placeholder strings for non-text segment types.
 * Each entry: { code, table, image, formula, media }
 */
const PLACEHOLDERS = {
  en: {
    code: "Code block.",
    table: "Table.",
    image: "Image.",
    formula: "Formula.",
    media: "Media.",
  },
  zh: {
    code: "代码块。",
    table: "表格。",
    image: "图片。",
    formula: "公式。",
    media: "媒体。",
  },
  ja: {
    code: "コードブロック。",
    table: "表。",
    image: "画像。",
    formula: "数式。",
    media: "メディア。",
  },
  ko: {
    code: "코드 블록.",
    table: "표.",
    image: "이미지.",
    formula: "수식.",
    media: "미디어.",
  },
};

// Non-text segment types keyed by tag name.
// textFn receives (el, placeholders) so it can use localized fallbacks.
const SPECIAL_TAGS = {
  PRE: { type: "code", textFn: (_el, p) => p.code },
  TABLE: { type: "table", textFn: (_el, p) => p.table },
  IMG: { type: "image", textFn: (el, p) => el.getAttribute("alt") || p.image },
  PICTURE: { type: "image", textFn: (el, p) => el.getAttribute("title") || p.media },
  VIDEO: { type: "image", textFn: (el, p) => el.getAttribute("title") || p.media },
  AUDIO: { type: "image", textFn: (el, p) => el.getAttribute("title") || p.media },
};

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG"]);
const FORMULA_CLASSES = ["math", "katex", "mathjax"];
const BR_SENTINEL = "\x00BR\x00";

// ── Unicode range helpers ────────────────────────────────────────────────────

// CJK Unified Ideographs and extensions (broadly "Chinese characters").
// Note: supplementary-plane CJK (U+20000..U+2A6DF) requires the /u flag and
// \u{} escape; without /u the 6-digit \u escape is misinterpreted.
const RE_CJK = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]|[\u{20000}-\u{2A6DF}]/u;
// Japanese kana (hiragana + katakana)
const RE_KANA = /[\u3040-\u30FF]/;
// Korean Hangul syllables
const RE_HANGUL = /[\uAC00-\uD7AF\u1100-\u11FF]/;

/**
 * Detect the dominant script in a text sample.
 * Returns "zh", "ja", "ko", or null.
 */
function detectScript(text) {
  // Sample at most 500 characters for performance.
  const sample = text.length > 500 ? text.slice(0, 500) : text;

  // Korean Hangul is unique — check first.
  if (RE_HANGUL.test(sample)) return "ko";

  // Japanese kana (hiragana/katakana) distinguishes ja from zh.
  if (RE_KANA.test(sample)) return "ja";

  // CJK ideographs without kana → Chinese.
  if (RE_CJK.test(sample)) return "zh";

  return null;
}

/**
 * Resolve the language code for the pipeline context.
 *
 * Priority:
 *   1. `context.lang` (explicitly set before pipeline runs), normalized to
 *      a known base tag ("zh", "ja", "ko"). If the tag (or its prefix) is
 *      not in PLACEHOLDERS, fall back to heuristics / "en".
 *   2. Character-based heuristics on body text content.
 *   3. "en" (default).
 *
 * Returns one of: "en" | "zh" | "ja" | "ko".
 * Also normalizes `context.lang` to the resolved value.
 */
function resolveLang(context) {
  if (context.lang) {
    const raw = String(context.lang).toLowerCase();
    // Exact match first.
    if (PLACEHOLDERS[raw]) return raw;
    // Prefix match: "zh-tw", "zh-hans", "ja-jp", "ko-kr", …
    for (const key of Object.keys(PLACEHOLDERS)) {
      if (key !== "en" && raw.startsWith(key)) return key;
    }
    // Explicit lang present but unrecognized — fall through to heuristics.
  }

  // Heuristic: scan body text.
  const text = context.body ? context.body.textContent : "";
  const detected = detectScript(text);
  if (detected) return detected;

  return "en";
}

// ── DOM traversal helpers ────────────────────────────────────────────────────

function normalizeText(text) {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .normalize("NFC");
}

function isFormulaElement(el) {
  if (!el.className) return false;
  const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
  return FORMULA_CLASSES.some((fc) => cls.includes(fc));
}

/**
 * Check whether an element has any block-level child element.
 */
function hasBlockChild(el) {
  for (const child of el.childNodes) {
    if (child.nodeType === 1 && !INLINE_TAGS.has(child.tagName) && !SKIP_TAGS.has(child.tagName)) {
      return true;
    }
  }
  return false;
}

/**
 * Extract text from a leaf block, splitting at <br> boundaries.
 * Returns an array of normalized text strings (empty strings filtered out).
 */
function extractTexts(el) {
  // Clone to avoid mutating the pipeline DOM.
  const clone = el.cloneNode(true);
  for (const br of [...clone.querySelectorAll("br")]) {
    br.replaceWith(clone.ownerDocument.createTextNode(BR_SENTINEL));
  }
  return clone.textContent.split(BR_SENTINEL).map(normalizeText).filter(Boolean);
}

function walk(node, segments, placeholders) {
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue;
    const el = child;
    const tag = el.tagName;

    if (SKIP_TAGS.has(tag)) continue;

    // Formula detection (class-based, takes priority).
    if (isFormulaElement(el)) {
      segments.push({ type: "formula", text: placeholders.formula, html: el.outerHTML });
      continue;
    }

    // Special rendering types.
    const special = SPECIAL_TAGS[tag];
    if (special) {
      segments.push({
        type: special.type,
        text: special.textFn(el, placeholders),
        html: el.outerHTML,
      });
      continue;
    }

    // Inline elements — normally part of their parent's textContent.
    // Exception: if an inline element wraps block content (e.g. <a><p>...</p></a>),
    // recurse into it so the block children are processed.
    if (INLINE_TAGS.has(tag)) {
      if (hasBlockChild(el)) walk(el, segments, placeholders);
      continue;
    }

    // Block element: leaf-block heuristic.
    if (hasBlockChild(el)) {
      walk(el, segments, placeholders);
    } else {
      for (const text of extractTexts(el)) {
        segments.push({ type: "text", text, html: null });
      }
    }
  }
}

export function structure(context) {
  const lang = resolveLang(context);
  context.lang = lang;

  const placeholders = PLACEHOLDERS[lang];
  const segments = [];
  walk(context.body, segments, placeholders);
  context.segments = segments;
  return context;
}
