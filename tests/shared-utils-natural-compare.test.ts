import { describe, expect, it } from "vitest";

import { naturalCompare } from "../src/platform/core/shared-utils";

describe("naturalCompare", () => {
  it("orders numeric deck names numerically, not lexicographically", () => {
    const decks = ["11.", "2.", "1.", "10.", "3.", "4."];
    const sorted = [...decks].sort(naturalCompare);
    expect(sorted).toEqual(["1.", "2.", "3.", "4.", "10.", "11."]);
  });

  it("sorts mixed alpha-numeric strings naturally", () => {
    const values = ["file2", "file10", "file1"];
    expect([...values].sort(naturalCompare)).toEqual(["file1", "file2", "file10"]);
  });

  it("handles embedded numbers within longer names", () => {
    const values = ["Topic 9", "Topic 20", "Topic 3"];
    expect([...values].sort(naturalCompare)).toEqual(["Topic 3", "Topic 9", "Topic 20"]);
  });

  it("returns a stable order (0) for equal names", () => {
    expect(naturalCompare("same", "same")).toBe(0);
  });
});
