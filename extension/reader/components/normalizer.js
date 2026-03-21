/**
 * Canonical text normalization pipeline.
 * Ensures TTS input and rendered spans share the exact same string.
 */

/**
 * Normalize a text string: collapse whitespace, trim, NFC normalize.
 */
export function normalizeText(text) {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .normalize("NFC");
}

/**
 * Split normalized text into words with their character offsets.
 * Returns [{text, charOffset, charLength}, ...]
 */
export function splitIntoWords(normalizedText) {
  const words = [];
  const regex = /\S+/g;
  let match;
  while ((match = regex.exec(normalizedText)) !== null) {
    words.push({
      text: match[0],
      charOffset: match.index,
      charLength: match[0].length,
    });
  }
  return words;
}

/**
 * Parse HTML content into paragraphs of plain text.
 * Block-level elements become separate paragraphs.
 */
export function splitIntoParagraphs(htmlContent) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, "text/html");
  const blocks = doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, blockquote, li");
  const paragraphs = [];

  for (const block of blocks) {
    const text = normalizeText(block.textContent || "");
    if (text.length > 0) {
      paragraphs.push(text);
    }
  }

  // Fallback: if no block elements found, treat entire content as one paragraph
  if (paragraphs.length === 0) {
    const text = normalizeText(doc.body.textContent || "");
    if (text.length > 0) {
      paragraphs.push(text);
    }
  }

  return paragraphs;
}

/**
 * Render paragraphs into the content element with word spans.
 */
export function renderParagraphs(contentEl, paragraphs) {
  contentEl.innerHTML = "";
  paragraphs.forEach((paraText, paraIndex) => {
    const p = document.createElement("p");
    p.dataset.para = paraIndex;
    const words = splitIntoWords(paraText);
    words.forEach((word, wordIndex) => {
      if (wordIndex > 0) {
        p.appendChild(document.createTextNode(" "));
      }
      const span = document.createElement("span");
      span.dataset.word = wordIndex;
      span.dataset.charOffset = word.charOffset;
      span.textContent = word.text;
      p.appendChild(span);
    });
    contentEl.appendChild(p);
  });
}
