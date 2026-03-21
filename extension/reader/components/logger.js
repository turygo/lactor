/**
 * Injectable logger with debug mode detection.
 * - Enabled: logs with [Lactor:scope] prefix
 * - Disabled: only error() logs (always on)
 * - Console is injectable for testing
 */
export class Logger {
  /**
   * @param {boolean} enabled - whether debug logging is on
   * @param {Console} [cons] - injectable console (defaults to globalThis.console)
   */
  constructor(enabled, cons) {
    this._enabled = enabled;
    this._console = cons || globalThis.console;
  }

  log(scope, ...args) {
    if (!this._enabled) return;
    this._console.log(`[Lactor:${scope}]`, ...args);
  }

  warn(scope, ...args) {
    if (!this._enabled) return;
    this._console.warn(`[Lactor:${scope}]`, ...args);
  }

  error(scope, ...args) {
    // Errors always log
    this._console.error(`[Lactor:${scope}]`, ...args);
  }

  /**
   * Create a scoped logger that auto-prefixes a fixed scope name.
   */
  scope(name) {
    return new ScopedLogger(this, name);
  }
}

class ScopedLogger {
  constructor(parent, name) {
    this._parent = parent;
    this._name = name;
  }
  log(...args) {
    this._parent.log(this._name, ...args);
  }
  warn(...args) {
    this._parent.warn(this._name, ...args);
  }
  error(...args) {
    this._parent.error(this._name, ...args);
  }
}

/**
 * Detect if extension is loaded in debug/development mode.
 * Uses browser.management.getSelf() — requires "management" permission.
 * Falls back to true if API unavailable (safe default for development).
 */
export async function isDebugMode() {
  try {
    if (typeof browser !== "undefined" && browser.management) {
      const self = await browser.management.getSelf();
      return self.installType === "development";
    }
  } catch {}
  // API unavailable — likely a temporary add-on, default to enabled
  return true;
}
