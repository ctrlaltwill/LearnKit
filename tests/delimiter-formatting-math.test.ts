import { describe, expect, it } from "vitest";

import {
  escapeDelimiterText,
  formatDelimitedField,
  setDelimiter,
  unescapeDelimiterText,
} from "../src/platform/core/delimiter";

describe("delimiter field formatting", () => {
  it("preserves raw LaTeX backslashes in multiline CQ fields", () => {
    setDelimiter("|");

    const input = [
      "$$",
      String.raw`\begin{bmatrix}`,
      String.raw`1 \\`,
      String.raw`{{c1::0}}`,
      String.raw`\end{bmatrix}`,
      "$$",
    ].join("\n");

    const lines = formatDelimitedField("CQ", input);

    expect(lines).toEqual([
      "CQ | $$",
      String.raw`\begin{bmatrix}`,
      String.raw`1 \\`,
      String.raw`{{c1::0}}`,
      String.raw`\end{bmatrix}`,
      "$$",
      "|",
    ]);
  });

  it("still escapes delimiter characters while preserving non-delimiter backslashes", () => {
    setDelimiter("|");

    const input = String.raw`\begin{bmatrix}|x`;
    const line = formatDelimitedField("Q", input)[0];

    expect(line).toBe(String.raw`Q | \begin{bmatrix}\|x |`);

    const stored = line.slice("Q | ".length, -" |".length);
    expect(unescapeDelimiterText(stored)).toBe(input);
  });

  it("keeps legacy default escape behavior unless explicitly disabled", () => {
    setDelimiter("|");

    expect(escapeDelimiterText(String.raw`\begin{bmatrix}`)).toBe(String.raw`\\begin{bmatrix}`);
    expect(escapeDelimiterText(String.raw`\begin{bmatrix}`, { escapeBackslashes: false }))
      .toBe(String.raw`\begin{bmatrix}`);
  });
});
