export const DEFAULTS = Object.freeze({
  backendHost: "127.0.0.1",
  backendPort: 7890,
});

export function createConfig(overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  return Object.freeze({
    ...cfg,
    wsUrl() {
      return `ws://${cfg.backendHost}:${cfg.backendPort}/tts`;
    },
    httpUrl(path) {
      return `http://${cfg.backendHost}:${cfg.backendPort}${path}`;
    },
  });
}

export async function loadConfig(storage, overrides = {}) {
  let stored = {};
  try {
    stored = await storage.get(["port"]);
  } catch {}
  return createConfig({
    backendPort: stored.port ?? DEFAULTS.backendPort,
    ...overrides,
  });
}
