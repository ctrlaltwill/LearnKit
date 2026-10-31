// @vitest-environment jsdom

/**
 * Tests for the accent foreground calculation behind #224.
 *
 * LearnKit lets the user override the accent colour with an arbitrary hex, and
 * that override has no guaranteed contrast. Accent buttons used to hard-code
 * `#ffffff` on top of it, which is how a pale accent produced an unreadable
 * "Save" button. `onAccentForeground` decides black or white per colour.
 */

import { describe, expect, it } from "vitest";
import { onAccentForeground, parseHexColour } from "../src/platform/core/contrast";

describe("parseHexColour", () => {
  it("parses six-digit hex", () => {
    expect(parseHexColour("#ff8800")).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseHexColour("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColour("#FFFFFF")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("expands three-digit hex", () => {
    expect(parseHexColour("#f80")).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseHexColour("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("rejects anything that is not a hex colour", () => {
    for (const bad of ["", "red", "rgb(1,2,3)", "#ff", "#fffff", "ff0000", null, undefined, 42]) {
      expect(parseHexColour(bad)).toBeNull();
    }
  });
});

describe("onAccentForeground", () => {
  it("uses white text on dark accents", () => {
    expect(onAccentForeground("#7852ee")).toBe("#ffffff");
    expect(onAccentForeground("#000000")).toBe("#ffffff");
    expect(onAccentForeground("#1b1b1b")).toBe("#ffffff");
    expect(onAccentForeground("#0a3d62")).toBe("#ffffff");
  });

  it("uses black text on pale accents", () => {
    // The reported case: a light theme accent that white text disappeared on.
    expect(onAccentForeground("#ffffff")).toBe("#000000");
    expect(onAccentForeground("#e0e0e0")).toBe("#000000");
    expect(onAccentForeground("#ffe066")).toBe("#000000");
    expect(onAccentForeground("#9be64a")).toBe("#000000");
  });

  it("handles short hex the same way", () => {
    expect(onAccentForeground("#fff")).toBe("#000000");
    expect(onAccentForeground("#000")).toBe("#ffffff");
  });

  it("falls back to white for input it cannot read", () => {
    expect(onAccentForeground("")).toBe("#ffffff");
    expect(onAccentForeground("not-a-colour")).toBe("#ffffff");
    expect(onAccentForeground(null)).toBe("#ffffff");
  });
});
