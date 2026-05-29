/**
 * @file tests/flashcard-commands-regression.test.ts
 * @summary Regression checks for flashcard command registration source definitions.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("flashcard command registrations", () => {
  it("registers add-basic-flashcard exactly once", () => {
    const filePath = resolve(__dirname, "../src/platform/plugin/lifecycle-methods.ts");
    const source = readFileSync(filePath, "utf8");
    const matches = source.match(/id:\s*\"add-basic-flashcard\"/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
