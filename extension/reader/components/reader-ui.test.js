import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createReaderUI } from "./reader-ui.js";

function makeUI(html = "") {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="loading" style="display:none"></div>
    <div id="error" style="display:none"></div>
    <article id="content">${html}</article>
  </body></html>`);
  const doc = dom.window.document;
  const renderSegments = mock.fn();

  const ui = createReaderUI({
    contentEl: doc.getElementById("content"),
    loadingEl: doc.getElementById("loading"),
    errorEl: doc.getElementById("error"),
    document: doc,
    renderSegments,
  });

  return { ui, doc, renderSegments };
}

const PARA_HTML = `
  <p data-para="0">Hello</p>
  <p data-para="1">World</p>
  <p data-para="2">Foo</p>
`;

describe("createReaderUI", () => {
  describe("showLoading / hideLoading", () => {
    it("shows loading indicator", () => {
      const { ui, doc } = makeUI();
      ui.showLoading();
      assert.equal(doc.getElementById("loading").style.display, "block");
    });

    it("hides loading indicator", () => {
      const { ui, doc } = makeUI();
      ui.showLoading();
      ui.hideLoading();
      assert.equal(doc.getElementById("loading").style.display, "none");
    });
  });

  describe("showError", () => {
    it("hides loading and shows error message", () => {
      const { ui, doc } = makeUI();
      ui.showLoading();
      ui.showError("Something broke");
      assert.equal(doc.getElementById("loading").style.display, "none");
      assert.equal(doc.getElementById("error").style.display, "block");
      assert.equal(doc.getElementById("error").textContent, "Something broke");
    });
  });

  describe("renderContent", () => {
    it("delegates to renderSegments with contentEl", () => {
      const { ui, doc, renderSegments } = makeUI();
      const segments = [{ type: "text", text: "hi" }];
      ui.renderContent(segments, "https://example.com");
      assert.equal(renderSegments.mock.callCount(), 1);
      const args = renderSegments.mock.calls[0].arguments;
      assert.equal(args[0], doc.getElementById("content"));
      assert.equal(args[1], segments);
      assert.equal(args[2], "https://example.com");
    });
  });

  describe("setTitle", () => {
    it("creates h1 and prepends to contentEl", () => {
      const { ui, doc } = makeUI();
      ui.setTitle("My Title");
      const h1 = doc.getElementById("content").querySelector("h1");
      assert.ok(h1);
      assert.equal(h1.textContent, "My Title");
    });

    it("does nothing for empty title", () => {
      const { ui, doc } = makeUI();
      ui.setTitle("");
      assert.equal(doc.getElementById("content").querySelector("h1"), null);
    });

    it("does nothing for null title", () => {
      const { ui, doc } = makeUI();
      ui.setTitle(null);
      assert.equal(doc.getElementById("content").querySelector("h1"), null);
    });
  });

  describe("markCurrent", () => {
    it("adds current-para class to target paragraph", () => {
      const { ui, doc } = makeUI(PARA_HTML);
      ui.markCurrent(1);
      assert.ok(doc.querySelector('[data-para="1"]').classList.contains("current-para"));
    });

    it("removes current-para from previously marked paragraph", () => {
      const { ui, doc } = makeUI(PARA_HTML);
      ui.markCurrent(0);
      ui.markCurrent(1);
      assert.ok(!doc.querySelector('[data-para="0"]').classList.contains("current-para"));
      assert.ok(doc.querySelector('[data-para="1"]').classList.contains("current-para"));
    });

    it("does not throw for non-existent paragraph", () => {
      const { ui } = makeUI(PARA_HTML);
      ui.markCurrent(99); // should not throw
    });
  });

  describe("markPlayed", () => {
    it("removes current-para and adds played class", () => {
      const { ui, doc } = makeUI(PARA_HTML);
      ui.markCurrent(1);
      ui.markPlayed(1);
      const el = doc.querySelector('[data-para="1"]');
      assert.ok(!el.classList.contains("current-para"));
      assert.ok(el.classList.contains("played"));
    });

    it("does not throw for non-existent paragraph", () => {
      const { ui } = makeUI(PARA_HTML);
      ui.markPlayed(99); // should not throw
    });
  });
});
