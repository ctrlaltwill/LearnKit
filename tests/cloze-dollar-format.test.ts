import { describe, expect, it } from "vitest";
import { formatDelimitedField } from "../src/platform/core/delimiter";

describe("formatDelimitedField with $$ matrix", () => {
  it("produces correct output for matrix with $$ on own lines", () => {
    const input = String.raw`$$
\begin{bmatrix}
1 & 1\\
1&1
\end{bmatrix}+\begin{bmatrix}
0 \\
0
\end{bmatrix}={{c1:: \begin{bmatrix}
1 \\
1
\end{bmatrix} }}
$$`;
    const result = formatDelimitedField("CQ", input);
    console.log("RESULT LINES:");
    result.forEach((line, i) => console.log(`  [${i}]: ${JSON.stringify(line)}`));
    
    // The last content line $$ should be followed by | on its own line
    const joined = result.join("\n");
    console.log("JOINED:", JSON.stringify(joined));
    
    // $$ should appear in the output
    expect(joined).toContain("$$");
    
    // Should have opening and closing $$
    const dollarPairs = (joined.match(/\$\$/g) || []).length;
    expect(dollarPairs).toBe(2);
  });

  it("produces correct output for matrix with closing $$ on same line", () => {
    const input = String.raw`$$
\begin{bmatrix}
1 & 1\\
1&1
\end{bmatrix}+\begin{bmatrix}
0 \\
0
\end{bmatrix}={{c1:: \begin{bmatrix}
1 \\
1
\end{bmatrix} }}$$`;
    const result = formatDelimitedField("CQ", input);
    console.log("RESULT LINES (same-line $$):");
    result.forEach((line, i) => console.log(`  [${i}]: ${JSON.stringify(line)}`));
    
    const joined = result.join("\n");
    console.log("JOINED:", JSON.stringify(joined));
    
    const dollarPairs = (joined.match(/\$\$/g) || []).length;
    expect(dollarPairs).toBe(2);
  });
});
