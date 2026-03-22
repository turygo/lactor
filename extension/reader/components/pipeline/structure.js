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

// Non-text segment types keyed by tag name.
const SPECIAL_TAGS = {
  PRE: { type: "code", textFn: () => "Code block." },
  TABLE: { type: "table", textFn: () => "Table." },
  IMG: { type: "image", textFn: (el) => el.getAttribute("alt") || "Image." },
  PICTURE: { type: "image", textFn: (el) => el.getAttribute("title") || "Media." },
  VIDEO: { type: "image", textFn: (el) => el.getAttribute("title") || "Media." },
  AUDIO: { type: "image", textFn: (el) => el.getAttribute("title") || "Media." },
};

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG"]);

const FORMULA_CLASSES = ["math", "katex", "mathjax"];

const BR_SENTINEL = "\x00BR\x00";

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

function walk(node, segments) {
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue;
    const el = child;
    const tag = el.tagName;

    if (SKIP_TAGS.has(tag)) continue;

    // Formula detection (class-based, takes priority).
    if (isFormulaElement(el)) {
      segments.push({ type: "formula", text: "Formula.", html: el.outerHTML });
      continue;
    }

    // Special rendering types.
    const special = SPECIAL_TAGS[tag];
    if (special) {
      segments.push({
        type: special.type,
        text: special.textFn(el),
        html: el.outerHTML,
      });
      continue;
    }

    // Inline elements — normally part of their parent's textContent.
    // Exception: if an inline element wraps block content (e.g. <a><p>...</p></a>),
    // recurse into it so the block children are processed.
    if (INLINE_TAGS.has(tag)) {
      if (hasBlockChild(el)) walk(el, segments);
      continue;
    }

    // Block element: leaf-block heuristic.
    if (hasBlockChild(el)) {
      walk(el, segments);
    } else {
      for (const text of extractTexts(el)) {
        segments.push({ type: "text", text, html: null });
      }
    }
  }
}

export function structure(context) {
  const segments = [];
  walk(context.body, segments);
  context.segments = segments;
  return context;
}
