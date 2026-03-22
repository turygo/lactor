import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Provide DOMParser globally so the pipeline module can use it.
const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser;

const { createPipeline } = await import("./index.js");

describe("createPipeline", () => {
  it("returns an object with a run method", () => {
    const pipeline = createPipeline([]);
    assert.equal(typeof pipeline.run, "function");
  });

  it("stages execute in order", () => {
    const order = [];
    const stageA = () => order.push("a");
    const stageB = () => order.push("b");

    const pipeline = createPipeline([stageA, stageB]);
    pipeline.run("<p>hello</p>");

    assert.deepEqual(order, ["a", "b"]);
  });

  it("context is passed through stages", () => {
    const addSegments = (ctx) => {
      ctx.segments = [{ type: "text", text: ctx.body.textContent }];
    };
    const addCount = (ctx) => {
      ctx.count = ctx.segments.length;
    };

    const pipeline = createPipeline([addSegments, addCount]);
    const ctx = pipeline.run("<p>hello</p>");

    assert.equal(ctx.count, 1);
    assert.equal(ctx.segments[0].text, "hello");
    assert.ok(ctx.doc);
    assert.ok(ctx.body);
  });
});
