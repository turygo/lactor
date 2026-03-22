/**
 * Sanitize stage — removes semantic noise and low-quality blocks from a
 * parsed article body.
 *
 * @param {{ doc: Document, body: Element }} context
 * @returns {{ doc: Document, body: Element }} same context (for chaining)
 */
export function sanitize(context) {
  const { body } = context;

  // ── 1. Semantic noise removal ─────────────────────────────────
  const noiseSelector = ["nav", "aside", '[role="navigation"]', '[role="complementary"]'].join(",");

  for (const el of [...body.querySelectorAll(noiseSelector)]) {
    el.remove();
  }

  // ── 2. Lightweight content scoring on direct children ─────────
  const HEADING_RE = /^H[1-6]$/;
  const MEDIA_SELECTOR = "img, picture, video, audio, pre, table, figure, svg";

  for (const child of [...body.children]) {
    const text = (child.textContent || "").trim();
    const len = text.length;

    // Skip headings — never remove them for being short
    if (HEADING_RE.test(child.tagName)) continue;

    // Skip blocks that contain media — structure stage will classify them
    if (child.querySelector(MEDIA_SELECTOR) || child.matches(MEDIA_SELECTOR)) continue;

    // Remove empty blocks
    if (len === 0) {
      child.remove();
      continue;
    }

    // Compute link density
    const linkText = [...child.querySelectorAll("a")]
      .map((a) => (a.textContent || "").trim())
      .join("");
    const linkDensity = linkText.length / len;

    // Remove blocks with extreme link density (>80%)
    if (linkDensity > 0.8) {
      child.remove();
      continue;
    }

    // Remove high link-density (>60%) short blocks (<100 chars)
    if (linkDensity > 0.6 && len < 100) {
      child.remove();
      continue;
    }

    // Remove very short blocks (<30 chars) that are not headings
    if (len < 30) {
      child.remove();
      continue;
    }
  }

  return context;
}
