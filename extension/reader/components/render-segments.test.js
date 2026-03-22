import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
globalThis.document = dom.window.document;

import { renderSegments } from "./render-segments.js";

describe("renderSegments", () => {
  let contentEl;

  beforeEach(() => {
    contentEl = document.createElement("div");
  });

  it("renders text segment as <p> with word spans", () => {
    renderSegments(contentEl, [{ type: "text", text: "Hello world" }]);
    const p = contentEl.querySelector("p");
    assert.ok(p, "should create a <p> element");
    const spans = p.querySelectorAll("span");
    assert.equal(spans.length, 2);
    assert.equal(spans[0].textContent, "Hello");
    assert.equal(spans[1].textContent, "world");
  });

  it("text segment has correct data-para and data-segment-type", () => {
    renderSegments(contentEl, [{ type: "text", text: "Hi" }]);
    const p = contentEl.querySelector("p");
    assert.equal(p.dataset.para, "0");
    assert.equal(p.dataset.segmentType, "text");
  });

  it("word spans have correct data-word and data-char-offset", () => {
    renderSegments(contentEl, [{ type: "text", text: "foo bar" }]);
    const spans = contentEl.querySelectorAll("span");
    assert.equal(spans[0].dataset.word, "0");
    assert.equal(spans[0].dataset.charOffset, "0");
    assert.equal(spans[1].dataset.word, "1");
    assert.equal(spans[1].dataset.charOffset, "4");
  });

  it("renders code segment as <div> with innerHTML", () => {
    const html = "<pre><code>const x = 1;</code></pre>";
    renderSegments(contentEl, [{ type: "code", html }]);
    const div = contentEl.querySelector("div");
    assert.ok(div, "should create a <div> element");
    assert.equal(div.innerHTML, html);
  });

  it("renders table segment as <div> with innerHTML", () => {
    const html = "<table><tr><td>A</td></tr></table>";
    renderSegments(contentEl, [{ type: "table", html }]);
    const div = contentEl.querySelector("div");
    assert.ok(div);
    // Browser/jsdom auto-inserts <tbody>, so check the table cell content
    assert.ok(div.querySelector("td"));
    assert.equal(div.querySelector("td").textContent, "A");
  });

  it("renders image segment as <div>", () => {
    renderSegments(contentEl, [{ type: "image", text: "[image]" }]);
    const div = contentEl.querySelector("div");
    assert.ok(div);
    assert.equal(div.textContent, "[image]");
  });

  it("non-text segments have data-segment-type attribute", () => {
    renderSegments(contentEl, [
      { type: "code", html: "<pre>x</pre>" },
      { type: "table", html: "<table></table>" },
      { type: "image", text: "img" },
      { type: "formula", text: "E=mc^2" },
    ]);
    const divs = contentEl.querySelectorAll("div");
    assert.equal(divs[0].dataset.segmentType, "code");
    assert.equal(divs[1].dataset.segmentType, "table");
    assert.equal(divs[2].dataset.segmentType, "image");
    assert.equal(divs[3].dataset.segmentType, "formula");
  });

  it("renders mixed segments in order with correct para indices", () => {
    renderSegments(contentEl, [
      { type: "text", text: "Hello" },
      { type: "code", html: "<pre>x</pre>" },
      { type: "text", text: "World" },
    ]);
    const children = contentEl.children;
    assert.equal(children.length, 3);
    assert.equal(children[0].tagName, "P");
    assert.equal(children[0].dataset.para, "0");
    assert.equal(children[1].tagName, "DIV");
    assert.equal(children[1].dataset.para, "1");
    assert.equal(children[2].tagName, "P");
    assert.equal(children[2].dataset.para, "2");
  });

  it("clears existing content before rendering", () => {
    contentEl.innerHTML = "<p>old content</p>";
    renderSegments(contentEl, [{ type: "text", text: "new" }]);
    assert.equal(contentEl.children.length, 1);
    assert.equal(contentEl.querySelector("span").textContent, "new");
  });

  it("handles empty segments array", () => {
    contentEl.innerHTML = "<p>old</p>";
    renderSegments(contentEl, []);
    assert.equal(contentEl.children.length, 0);
    assert.equal(contentEl.innerHTML, "");
  });
});
