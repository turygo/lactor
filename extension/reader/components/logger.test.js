import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Logger } from "./logger.js";

describe("Logger", () => {
  it("logs nothing when disabled", () => {
    const output = [];
    const logger = new Logger(false, { log: (...args) => output.push(args) });
    logger.log("test", "hello");
    assert.equal(output.length, 0);
  });

  it("logs with prefix when enabled", () => {
    const output = [];
    const logger = new Logger(true, { log: (...args) => output.push(args) });
    logger.log("scheduler", "fetching para", 3);
    assert.equal(output.length, 1);
    assert.equal(output[0][0], "[Lactor:scheduler]");
    assert.equal(output[0][1], "fetching para");
    assert.equal(output[0][2], 3);
  });

  it("warn logs with prefix when enabled", () => {
    const output = [];
    const logger = new Logger(true, { warn: (...args) => output.push(args) });
    logger.warn("player", "decode failed");
    assert.equal(output.length, 1);
    assert.equal(output[0][0], "[Lactor:player]");
  });

  it("error always logs regardless of enabled flag", () => {
    const output = [];
    const logger = new Logger(false, { error: (...args) => output.push(args) });
    logger.error("ws", "connection lost");
    assert.equal(output.length, 1);
    assert.equal(output[0][0], "[Lactor:ws]");
  });

  it("accepts injected console for testing", () => {
    const calls = { log: 0, warn: 0, error: 0 };
    const mockConsole = {
      log: () => calls.log++,
      warn: () => calls.warn++,
      error: () => calls.error++,
    };
    const logger = new Logger(true, mockConsole);
    logger.log("a", "x");
    logger.warn("b", "y");
    logger.error("c", "z");
    assert.deepEqual(calls, { log: 1, warn: 1, error: 1 });
  });

  it("creates a scoped child logger", () => {
    const output = [];
    const logger = new Logger(true, { log: (...args) => output.push(args) });
    const scoped = logger.scope("scheduler");
    scoped.log("prefetch started");
    assert.equal(output[0][0], "[Lactor:scheduler]");
    assert.equal(output[0][1], "prefetch started");
  });

  it("scoped logger inherits enabled state", () => {
    const output = [];
    const logger = new Logger(false, { log: (...args) => output.push(args) });
    const scoped = logger.scope("reader");
    scoped.log("should not appear");
    assert.equal(output.length, 0);
  });
});
