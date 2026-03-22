import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser;

const { structure } = await import("./structure.js");

/** Helper: build a context from an HTML string. */
function ctx(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return { doc, body: doc.body };
}

describe("structure", () => {
  // ── Text extraction (leaf-block heuristic) ───────────────────

  it("converts <p> to text segment", () => {
    const c = ctx("<p>Hello world</p>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.deepEqual(c.segments[0], { type: "text", text: "Hello world", html: null });
  });

  it("converts <h1> through <h6> to text segments", () => {
    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
      const c = ctx(`<${tag}>Heading</${tag}>`);
      structure(c);
      assert.equal(c.segments.length, 1, `expected 1 segment for <${tag}>`);
      assert.equal(c.segments[0].type, "text");
      assert.equal(c.segments[0].text, "Heading");
    }
  });

  it("converts <blockquote> to text segment", () => {
    const c = ctx("<blockquote>Quoted text</blockquote>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "text");
    assert.equal(c.segments[0].text, "Quoted text");
  });

  it("converts <li> to text segment", () => {
    const c = ctx("<ul><li>Item one</li></ul>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "text");
    assert.equal(c.segments[0].text, "Item one");
  });

  it("converts <figcaption> to text segment (no hardcoded tag needed)", () => {
    const c = ctx("<figure><img><figcaption>Caption text</figcaption></figure>");
    structure(c);
    const textSegs = c.segments.filter((s) => s.type === "text");
    assert.equal(textSegs.length, 1);
    assert.equal(textSegs[0].text, "Caption text");
  });

  it("handles any unknown/custom block element as text leaf", () => {
    const c = ctx("<my-widget>Custom element content</my-widget>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "text");
    assert.equal(c.segments[0].text, "Custom element content");
  });

  it("handles <address>, <dd>, <dt>, <summary> without hardcoding", () => {
    const c = ctx("<address>123 Main St</address><dl><dt>Term</dt><dd>Definition</dd></dl>");
    structure(c);
    const texts = c.segments.map((s) => s.text);
    assert.ok(texts.includes("123 Main St"));
    assert.ok(texts.includes("Term"));
    assert.ok(texts.includes("Definition"));
  });

  // ── <br> splitting ───────────────────────────────────────────

  it("splits text at <br> boundaries", () => {
    const c = ctx("<div>Line one<br>Line two<br>Line three</div>");
    structure(c);
    assert.equal(c.segments.length, 3);
    assert.equal(c.segments[0].text, "Line one");
    assert.equal(c.segments[1].text, "Line two");
    assert.equal(c.segments[2].text, "Line three");
  });

  it("splits at consecutive <br><br> and discards empty parts", () => {
    const c = ctx("<div>Para one<br><br>Para two</div>");
    structure(c);
    assert.equal(c.segments.length, 2);
    assert.equal(c.segments[0].text, "Para one");
    assert.equal(c.segments[1].text, "Para two");
  });

  it("handles figcaption with <br> (Zhihu answer pattern)", () => {
    const c = ctx(
      "<figure><img><figcaption>First paragraph.<br><br>Second paragraph.<br><br>Third.</figcaption></figure>"
    );
    structure(c);
    const textSegs = c.segments.filter((s) => s.type === "text");
    assert.equal(textSegs.length, 3);
    assert.equal(textSegs[0].text, "First paragraph.");
    assert.equal(textSegs[1].text, "Second paragraph.");
    assert.equal(textSegs[2].text, "Third.");
  });

  // ── Special types ────────────────────────────────────────────

  it("converts <pre><code> to code segment", () => {
    const c = ctx("<pre><code>const x = 1;</code></pre>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "code");
    assert.equal(c.segments[0].text, "Code block.");
    assert.ok(c.segments[0].html.includes("<pre>"));
  });

  it("converts <table> to table segment", () => {
    const c = ctx("<table><tr><td>Cell</td></tr></table>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "table");
    assert.equal(c.segments[0].text, "Table.");
  });

  it("converts <img> to image segment with alt text", () => {
    const c = ctx('<img alt="photo">');
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "image");
    assert.equal(c.segments[0].text, "photo");
  });

  it("converts <img> without alt to image segment with fallback", () => {
    const c = ctx("<img>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "image");
    assert.equal(c.segments[0].text, "Image.");
  });

  it("converts formula container to formula segment", () => {
    const c = ctx('<span class="math">x^2</span>');
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "formula");
    assert.equal(c.segments[0].text, "Formula.");
  });

  // ── Container recursion ──────────────────────────────────────

  it("recurses into container divs", () => {
    const c = ctx("<div><p>Inside div</p></div>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].text, "Inside div");
  });

  it("recurses into nested divs with direct text", () => {
    const c = ctx("<div><div>Para one</div><div>Para two</div></div>");
    structure(c);
    assert.equal(c.segments.length, 2);
    assert.equal(c.segments[0].text, "Para one");
    assert.equal(c.segments[1].text, "Para two");
  });

  it("recurses into <a> wrapping block elements", () => {
    const c = ctx('<a href="#"><p>Link paragraph</p></a>');
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].text, "Link paragraph");
  });

  // ── Filtering ────────────────────────────────────────────────

  it("skips empty text elements", () => {
    const c = ctx("<p>   </p><p>Real content</p>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].text, "Real content");
  });

  it("skips script and style elements", () => {
    const c = ctx("<script>alert(1)</script><style>body{}</style><p>Visible</p>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].text, "Visible");
  });

  it("skips SVG elements", () => {
    const c = ctx('<svg viewBox="0 0 1 1"><rect/></svg><p>After SVG</p>');
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].text, "After SVG");
  });

  // ── Ordering and mixed content ───────────────────────────────

  it("returns segments in document order", () => {
    const c = ctx("<h1>Title</h1><p>First</p><p>Second</p>");
    structure(c);
    assert.equal(c.segments.length, 3);
    assert.equal(c.segments[0].text, "Title");
    assert.equal(c.segments[1].text, "First");
    assert.equal(c.segments[2].text, "Second");
  });

  it("mixed segments produce correct output", () => {
    const html = [
      "<h2>Intro</h2>",
      "<p>Paragraph one.</p>",
      "<pre><code>let a = 1;</code></pre>",
      '<img alt="diagram">',
      "<table><tr><td>data</td></tr></table>",
      '<div class="math">E=mc^2</div>',
      "<blockquote>A quote</blockquote>",
    ].join("");
    const c = ctx(html);
    structure(c);

    assert.equal(c.segments.length, 7);
    assert.equal(c.segments[0].type, "text");
    assert.equal(c.segments[1].type, "text");
    assert.equal(c.segments[2].type, "code");
    assert.equal(c.segments[3].type, "image");
    assert.equal(c.segments[4].type, "table");
    assert.equal(c.segments[5].type, "formula");
    assert.equal(c.segments[6].type, "text");
  });

  it("returns context for chaining", () => {
    const c = ctx("<p>Test</p>");
    const result = structure(c);
    assert.equal(result, c);
  });
});
