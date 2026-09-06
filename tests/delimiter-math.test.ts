import { describe, expect, it } from "vitest";

import {
  setDelimiter,
  splitUnescapedDelimiters,
  unescapeDelimiterText,
} from "../src/platform/core/delimiter";

describe("unescapeDelimiterText (math-aware)", () => {
  it("preserves LaTeX norm bars inside inline math", () => {
    setDelimiter("|");
    const src = String.raw`$\|x\|$`;
    expect(unescapeDelimiterText(src)).toBe(src);
  });

  it("preserves display math norm bars", () => {
    setDelimiter("|");
    const src = String.raw`$$\left\|x\right\|$$`;
    expect(unescapeDelimiterText(src)).toBe(src);
  });

  it("still unescapes an escaped pipe outside math", () => {
    setDelimiter("|");
    expect(unescapeDelimiterText("a\\|b")).toBe("a|b");
  });

  it("preserves backslash commands inside math", () => {
    setDelimiter("|");
    const src = String.raw`$\begin{bmatrix}1\\2\end{bmatrix}$`;
    expect(unescapeDelimiterText(src)).toBe(src);
  });
});

describe("splitUnescapedDelimiters (math-aware)", () => {
  it("does not split absolute-value math", () => {
    setDelimiter("|");
    expect(splitUnescapedDelimiters("$|x|$")).toEqual(["$|x|$"]);
  });

  it("splits normal delimiter-separated text", () => {
    setDelimiter("|");
    expect(splitUnescapedDelimiters("a|b")).toEqual(["a", "b"]);
  });

  it("preserves norm math while splitting outside", () => {
    setDelimiter("|");
    expect(splitUnescapedDelimiters(String.raw`$\|x\|$|tail`)).toEqual([
      String.raw`$\|x\|$`,
      "tail",
    ]);
  });
});
