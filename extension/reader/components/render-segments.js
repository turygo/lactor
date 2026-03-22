import { splitIntoWords } from "./normalizer.js";

const URL_ATTRS = [
  { sel: "[src]", attr: "src" },
  { sel: "[href]", attr: "href" },
  { sel: "[poster]", attr: "poster" },
  { sel: "[srcset]", attr: "srcset" },
];

/**
 * Rebase relative URLs inside a DOM subtree against the original page URL.
 */
function rebaseUrls(container, baseUrl) {
  if (!baseUrl) return;
  for (const { sel, attr } of URL_ATTRS) {
    for (const el of container.querySelectorAll(sel)) {
      if (attr === "srcset") {
        el.setAttribute(
          "srcset",
          el
            .getAttribute("srcset")
            .split(",")
            .map((entry) => {
              const [url, ...rest] = entry.trim().split(/\s+/);
              try {
                return [new URL(url, baseUrl).href, ...rest].join(" ");
              } catch {
                return entry;
              }
            })
            .join(", ")
        );
      } else {
        const val = el.getAttribute(attr);
        if (val && !val.startsWith("data:")) {
          try {
            el.setAttribute(attr, new URL(val, baseUrl).href);
          } catch {
            /* malformed URL — leave as-is */
          }
        }
      }
    }
  }
}

/**
 * Render typed segments into the content element.
 * Replaces the old renderParagraphs() with segment-type awareness.
 *
 * @param {HTMLElement} contentEl - container to render into
 * @param {Array<{type: string, text?: string, html?: string}>} segments
 * @param {string} [pageUrl] - original page URL for rebasing relative URLs
 */
export function renderSegments(contentEl, segments, pageUrl) {
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
        rebaseUrls(div, pageUrl);
      } else {
        div.textContent = segment.text;
      }

      contentEl.appendChild(div);
    }
  });
}
