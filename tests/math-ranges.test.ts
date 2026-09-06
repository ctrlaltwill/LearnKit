import { describe, expect, it } from "vitest";

import {
  collectMathRanges,
  collectMathSegments,
  protectMathRanges,
} from "../src/platform/core/shared-utils";

function slices(text: string, ranges: Array<[number, number]>): string[] {
  return ranges.map(([s, e]) => text.slice(s, e));
}

describe("collectMathRanges", () => {
  it("detects display math $$...$$", () => {
    const text = "before $$a < b$$ after";
    expect(slices(text, collectMathRanges(text))).toEqual(["$$a < b$$"]);
  });

  it("detects explicit inline/display parens", () => {
    const text = String.raw`\(x\) and \[y\]`;
    expect(slices(text, collectMathRanges(text))).toEqual([
      String.raw`\(x\)`,
      String.raw`\[y\]`,
    ]);
  });

  it("detects inline $x<y$", () => {
    const text = "a $x<y$ b";
    expect(slices(text, collectMathRanges(text))).toEqual(["$x<y$"]);
  });

  it("ignores escaped \\$...\\$", () => {
    expect(collectMathRanges(String.raw`\$5 < 10\$`)).toEqual([]);
  });

  it("ignores unpaired $", () => {
    expect(collectMathRanges("a $ b c $ d $ e")).toEqual([]);
  });

  it("does not double-match $ inside $$...$$", () => {
    const text = "$$a$b$$";
    expect(slices(text, collectMathRanges(text))).toEqual(["$$a$b$$"]);
  });

  it("sorts ranges ascending", () => {
    const text = String.raw`\(a\) x $$b$$`;
    const ranges = collectMathRanges(text);
    expect(ranges.length).toBe(2);
    expect(ranges[0][0]).toBeLessThan(ranges[1][0]);
  });

  it("is null/empty safe", () => {
    expect(collectMathRanges("")).toEqual([]);
    expect(collectMathRanges(null as unknown as string)).toEqual([]);
  });
});

describe("protectMathRanges", () => {
  it("protects and restores math", () => {
    const { text, restore } = protectMathRanges("a $x<y$ b");
    expect(text).toBe("a @@SPROUTMATH0@@ b");
    expect(restore(text)).toBe("a $x<y$ b");
  });

  it("restore is identity when no math", () => {
    const { text, restore } = protectMathRanges("plain");
    expect(text).toBe("plain");
    expect(restore("plain")).toBe("plain");
  });
});

describe("collectMathSegments", () => {
  it("classifies display and extracts inner source for $$...$$", () => {
    expect(collectMathSegments("a $$x < y$$ b")).toEqual([
      { start: 2, end: 11, source: "x < y", display: true },
    ]);
  });

  it("classifies inline single-dollar math", () => {
    expect(collectMathSegments("a $x<y$ b")).toEqual([
      { start: 2, end: 7, source: "x<y", display: false },
    ]);
  });

  it("classifies explicit parens delimiters", () => {
    expect(collectMathSegments(String.raw`\(x\) and \[y\]`)).toEqual([
      { start: 0, end: 5, source: "x", display: false },
      { start: 10, end: 15, source: "y", display: true },
    ]);
  });

  it("returns multiple ordered segments", () => {
    const segments = collectMathSegments("$a$ then $$b$$");
    expect(segments.map((s) => s.source)).toEqual(["a", "b"]);
    expect(segments.map((s) => s.display)).toEqual([false, true]);
    expect(segments[0].start).toBeLessThan(segments[1].start);
  });

  it("is null/empty safe", () => {
    expect(collectMathSegments("")).toEqual([]);
    expect(collectMathSegments(null as unknown as string)).toEqual([]);
  });
});
