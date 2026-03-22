import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { DEFAULTS, createConfig, loadConfig } = await import("./config.js");

describe("createConfig", () => {
  it("uses DEFAULTS when no overrides", () => {
    const cfg = createConfig();
    assert.equal(cfg.backendHost, "127.0.0.1");
    assert.equal(cfg.backendPort, 7890);
  });

  it("applies overrides", () => {
    const cfg = createConfig({ backendHost: "10.0.0.1", backendPort: 9999 });
    assert.equal(cfg.backendHost, "10.0.0.1");
    assert.equal(cfg.backendPort, 9999);
  });

  it("partial override keeps other defaults", () => {
    const cfg = createConfig({ backendPort: 3000 });
    assert.equal(cfg.backendHost, "127.0.0.1");
    assert.equal(cfg.backendPort, 3000);
  });

  it("returns a frozen object", () => {
    const cfg = createConfig();
    assert.throws(() => {
      cfg.backendPort = 1234;
    }, TypeError);
  });
});

describe("config.wsUrl", () => {
  it("builds WebSocket URL from config", () => {
    const cfg = createConfig();
    assert.equal(cfg.wsUrl(), "ws://127.0.0.1:7890/tts");
  });

  it("reflects overrides", () => {
    const cfg = createConfig({ backendHost: "10.0.0.1", backendPort: 9999 });
    assert.equal(cfg.wsUrl(), "ws://10.0.0.1:9999/tts");
  });
});

describe("config.httpUrl", () => {
  it("builds HTTP URL for /health", () => {
    const cfg = createConfig();
    assert.equal(cfg.httpUrl("/health"), "http://127.0.0.1:7890/health");
  });

  it("builds HTTP URL for /voices", () => {
    const cfg = createConfig();
    assert.equal(cfg.httpUrl("/voices"), "http://127.0.0.1:7890/voices");
  });

  it("reflects overrides", () => {
    const cfg = createConfig({ backendPort: 3000 });
    assert.equal(cfg.httpUrl("/health"), "http://127.0.0.1:3000/health");
  });
});

describe("loadConfig", () => {
  it("loads port from storage", async () => {
    const storage = { get: async () => ({ port: 5555 }) };
    const cfg = await loadConfig(storage);
    assert.equal(cfg.backendPort, 5555);
    assert.equal(cfg.backendHost, "127.0.0.1");
  });

  it("falls back to DEFAULTS when storage is empty", async () => {
    const storage = { get: async () => ({}) };
    const cfg = await loadConfig(storage);
    assert.equal(cfg.backendPort, DEFAULTS.backendPort);
  });

  it("falls back to DEFAULTS when storage throws", async () => {
    const storage = {
      get: async () => {
        throw new Error("storage error");
      },
    };
    const cfg = await loadConfig(storage);
    assert.equal(cfg.backendPort, DEFAULTS.backendPort);
  });

  it("overrides take precedence over storage", async () => {
    const storage = { get: async () => ({ port: 5555 }) };
    const cfg = await loadConfig(storage, { backendPort: 8888 });
    assert.equal(cfg.backendPort, 8888);
  });

  it("overrides take precedence over defaults", async () => {
    const storage = { get: async () => ({}) };
    const cfg = await loadConfig(storage, { backendHost: "192.168.1.1" });
    assert.equal(cfg.backendHost, "192.168.1.1");
  });
});
