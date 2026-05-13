/**
 * @file tests/setup-vitest.ts
 * @summary Unit tests for setup vitest behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { vi } from "vitest";

// In Node/Vitest (no DOM environment), expose `window` as an alias for globalThis so
// that window-guarded code paths are reached and vi.stubGlobal("app", ...) etc. work.
if (typeof window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    writable: true,
    configurable: true,
  });
}

// Node-based Vitest runs cannot import raw .wasm modules directly.
// Mock sql.js wasm asset so suites that do not execute SQLite paths can load.
vi.mock("sql.js/dist/sql-wasm.wasm", () => ({
  default: new Uint8Array(),
}));
