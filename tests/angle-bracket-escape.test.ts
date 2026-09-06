import { describe, expect, it } from "vitest";

import { escapeAngleBracketsOutsideMathAndCode } from "../src/platform/core/shared-utils";

describe("escapeAngleBracketsOutsideMathAndCode", () => {
  it("leaves inline math with < and > untouched", () => {
    expect(escapeAngleBracketsOutsideMathAndCode("$a < b$")).toBe("$a < b$");
  });

  it("leaves \\langle/\\rangle math untouched", () => {
    const src = String.raw`$\langle x \rangle$`;
    expect(escapeAngleBracketsOutsideMathAndCode(src)).toBe(src);
  });

  it("leaves display math with matrices untouched", () => {
    const src = String.raw`$$\begin{bmatrix}1&2\\3&4\end{bmatrix}$$`;
    expect(escapeAngleBracketsOutsideMathAndCode(src)).toBe(src);
  });

  it("escapes literal angle brackets in prose", () => {
    expect(escapeAngleBracketsOutsideMathAndCode("Use <b> for bold")).toBe(
      "Use &lt;b&gt; for bold",
    );
  });

  it("preserves inline code spans", () => {
    expect(escapeAngleBracketsOutsideMathAndCode("`git reset <commit-sha>`")).toBe(
      "`git reset <commit-sha>`",
    );
  });

  it("keeps math intact while escaping prose tags", () => {
    expect(escapeAngleBracketsOutsideMathAndCode("$x$ then <tag>")).toBe(
      "$x$ then &lt;tag&gt;",
    );
  });

  it("escapes < in escaped-dollar text (not math)", () => {
    expect(escapeAngleBracketsOutsideMathAndCode(String.raw`\$5 < 10`)).toBe(
      String.raw`\$5 &lt; 10`,
    );
  });

  it("does not escape code spans nested around math delimiters", () => {
    expect(escapeAngleBracketsOutsideMathAndCode("`$a<b$`")).toBe("`$a<b$`");
  });
});
