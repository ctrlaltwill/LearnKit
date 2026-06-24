import { describe, expect, it } from "vitest";
import { processClozeForMath, convertInlineDisplayMath } from "../src/platform/core/shared-utils";

describe("GitHub #175: closing $$ positioning", () => {
  const matrixCard = String.raw`$$
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

  it("preserves closing $$ after cloze processing (front)", () => {
    const front = processClozeForMath(matrixCard, false, null);
    console.log("FRONT:", JSON.stringify(front));
    const count = (front.match(/\$\$/g) || []).length;
    expect(count).toBe(2);
  });

  it("preserves closing $$ after cloze processing (back)", () => {
    const back = processClozeForMath(matrixCard, true, null);
    console.log("BACK:", JSON.stringify(back));
    const count = (back.match(/\$\$/g) || []).length;
    expect(count).toBe(2);
  });

  it("convertInlineDisplayMath preserves $$ for multiline math", () => {
    const afterCloze = String.raw`$$
\begin{bmatrix}
1 & 1\\
1&1
\end{bmatrix}+\begin{bmatrix}
0 \\
0
\end{bmatrix}=\underline{\phantom{ \begin{bmatrix}
1 \\
1
\end{bmatrix} }}
$$`;
    const converted = convertInlineDisplayMath(afterCloze);
    console.log("CONVERTED:", JSON.stringify(converted));
    const count = (converted.match(/\$\$/g) || []).length;
    expect(count).toBe(2);
  });
});
