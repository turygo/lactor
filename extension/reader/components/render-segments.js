import { splitIntoWords } from "./normalizer.js";

/**
 * Render typed segments into the content element.
 * Replaces the old renderParagraphs() with segment-type awareness.
 *
 * @param {HTMLElement} contentEl - container to render into
 * @param {Array<{type: string, text?: string, html?: string}>} segments
 */
export function renderSegments(contentEl, segments) {
  contentEl.innerHTML = "";

  segments.forEach((segment, i) => {
    if (segment.type === "text") {
      const p = document.createElement("p");
      p.dataset.para = i;
      p.dataset.segmentType = "text";

      const words = splitIntoWords(segment.text);
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
    } else {
      const div = document.createElement("div");
      div.dataset.para = i;
      div.dataset.segmentType = segment.type;

      if (segment.html) {
        div.innerHTML = segment.html;
      } else {
        div.textContent = segment.text;
      }

      contentEl.appendChild(div);
    }
  });
}
