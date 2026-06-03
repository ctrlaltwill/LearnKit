import { describe, expect, it } from "vitest";

import { preserveMathLineBreakBackslashes } from "../src/views/reviewer/markdown-render";

describe("preserveMathLineBreakBackslashes", () => {
  it("expands matrix row-break pairs inside display math", () => {
    const input = String.raw`$$
\begin{bmatrix}
1 & 1\\
1 & 1
\end{bmatrix}
$$`;

    const out = preserveMathLineBreakBackslashes(input);

    expect(out).toContain(String.raw`\begin{bmatrix}`);
    expect(out).toContain(String.raw`1 & 1\\\\`);
    expect(out).toContain(String.raw`\end{bmatrix}`);
  });

  it("does not double command prefixes like \\\\begin", () => {
    const input = String.raw`$$\\begin{bmatrix}1 & 1\\\\1 & 1\\end{bmatrix}$$`;
    const out = preserveMathLineBreakBackslashes(input);

    expect(out).toBe(input);
  });

  it("leaves non-math content unchanged", () => {
    const input = String.raw`Path C:\Temp\notes and plain text`;
    const out = preserveMathLineBreakBackslashes(input);
    expect(out).toBe(input);
  });
});
