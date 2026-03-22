import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { sanitize } from "./sanitize.js";

/** Build a context object from an HTML body fragment. */
function ctx(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const doc = dom.window.document;
  return { doc, body: doc.body };
}

// ── Semantic noise removal ────────────────────────────────────────

describe("sanitize – semantic noise removal", () => {
  it("removes nav elements", () => {
    const c = ctx(
      `<nav><a href="/">Home</a></nav><p>Main content here that is long enough to survive scoring filters.</p>`
    );
    sanitize(c);
    assert.equal(c.body.querySelectorAll("nav").length, 0);
    assert.ok(c.body.querySelector("p"));
  });

  it("removes aside elements", () => {
    const c = ctx(
      `<aside>Related links sidebar</aside><p>Article body text that is long enough to survive the scoring filters.</p>`
    );
    sanitize(c);
    assert.equal(c.body.querySelectorAll("aside").length, 0);
    assert.ok(c.body.querySelector("p"));
  });

  it('removes role="navigation" elements', () => {
    const c = ctx(
      `<div role="navigation"><a href="/about">About</a></div><p>Content paragraph that has enough text to survive scoring.</p>`
    );
    sanitize(c);
    assert.equal(c.body.querySelectorAll('[role="navigation"]').length, 0);
    assert.ok(c.body.querySelector("p"));
  });

  it('removes role="complementary" elements', () => {
    const c = ctx(
      `<div role="complementary">Sidebar widget</div><p>Real content with enough length to survive the content scoring.</p>`
    );
    sanitize(c);
    assert.equal(c.body.querySelectorAll('[role="complementary"]').length, 0);
    assert.ok(c.body.querySelector("p"));
  });

  it("preserves main content paragraphs", () => {
    const c = ctx(
      `<nav>Nav</nav><p>Paragraph one with enough text to stay.</p><p>Paragraph two also has content.</p>`
    );
    sanitize(c);
    const paras = c.body.querySelectorAll("p");
    assert.equal(paras.length, 2);
  });
});

// ── Lightweight content scoring ───────────────────────────────────

describe("sanitize – content scoring", () => {
  it("removes empty blocks", () => {
    const c = ctx(`<div>   </div><p>Actual content in this paragraph.</p>`);
    sanitize(c);
    // The empty div should be gone
    const divs = c.body.querySelectorAll("div");
    assert.equal(divs.length, 0);
    assert.ok(c.body.querySelector("p"));
  });

  it("removes high link-density short blocks", () => {
    // >60% link text AND <100 chars total
    const c = ctx(
      `<div><a href="#">Click here now</a> ok</div><p>This is the main article content that should be preserved.</p>`
    );
    sanitize(c);
    // "Click here now ok" is ~18 chars, link is 14/18 = 78% > 60%, and < 100 chars
    const divs = c.body.querySelectorAll("div");
    assert.equal(divs.length, 0);
  });

  it("removes extreme link-density blocks", () => {
    // >80% link density, even if long text
    const linkText = "A".repeat(90);
    const plainText = "B".repeat(10);
    const c = ctx(
      `<div><a href="#">${linkText}</a>${plainText}</div><p>Preserved content paragraph here.</p>`
    );
    sanitize(c);
    const divs = c.body.querySelectorAll("div");
    assert.equal(divs.length, 0);
  });

  it("keeps short headings (h1-h6 are never removed for being short)", () => {
    const c = ctx(`<h2>Title</h2><p>This is the article body with enough content.</p>`);
    sanitize(c);
    assert.ok(c.body.querySelector("h2"));
    assert.equal(c.body.querySelector("h2").textContent, "Title");
  });

  it("preserves blocks containing media elements", () => {
    const c = ctx(
      [
        '<div><img src="hero.jpg"></div>',
        '<figure><img src="photo.jpg"><figcaption>Caption</figcaption></figure>',
        "<div><pre><code>const x = 1;</code></pre></div>",
        "<div><table><tr><td>data</td></tr></table></div>",
        "<p>A regular paragraph with enough content to survive scoring.</p>",
      ].join("")
    );
    sanitize(c);
    assert.ok(c.body.querySelector("img"), "img block should survive");
    assert.ok(c.body.querySelector("figure"), "figure should survive");
    assert.ok(c.body.querySelector("pre"), "pre block should survive");
    assert.ok(c.body.querySelector("table"), "table block should survive");
  });

  it("preserves article body content", () => {
    const c = ctx(
      [
        "<h1>Article Title</h1>",
        "<p>First paragraph of the article with substantial content that makes it clearly worth keeping.</p>",
        "<p>Second paragraph also has enough meaningful text to survive content scoring easily.</p>",
        "<blockquote>A notable quote from someone important in the article.</blockquote>",
      ].join("")
    );
    sanitize(c);
    assert.equal(c.body.querySelectorAll("h1").length, 1);
    assert.equal(c.body.querySelectorAll("p").length, 2);
    assert.equal(c.body.querySelectorAll("blockquote").length, 1);
  });
});

// ── Return value ──────────────────────────────────────────────────

describe("sanitize – return value", () => {
  it("returns context for chaining", () => {
    const c = ctx(`<p>Hello world content here.</p>`);
    const result = sanitize(c);
    assert.equal(result, c);
  });
});
