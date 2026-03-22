import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    // Extension source files run in browser/WebExtension environment
    files: ["extension/**/*.js"],
    ignores: ["extension/lib/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      // Empty catch blocks are intentional in extension code (e.g. port.postMessage
      // on a disconnected port must not throw — we deliberately swallow the error)
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // extractor.js receives Defuddle via executeScript injection before it runs
    files: ["extension/content/extractor.js"],
    languageOptions: {
      globals: { Defuddle: "readonly" },
    },
  },
  {
    // Test files run under Node.js test runner (node:test)
    files: ["extension/**/*.test.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Benchmark scripts run under Node.js
    files: ["benchmark/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
];
