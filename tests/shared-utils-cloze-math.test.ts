/**
 * @file tests/shared-utils-cloze-math.test.ts
 * @summary Unit tests for shared utils cloze math.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, expect, it } from "vitest";
import { convertInlineDisplayMath, processClozeForMath } from "../src/platform/core/shared-utils";

describe("processClozeForMath", () => {
  it("keeps LaTeX valid for clozes with nested braces", () => {
    const input = "$$x = {{c1::\\frac{-b}{2a}}}$$";

    const front = processClozeForMath(input, false, null);
    const back = processClozeForMath(input, true, null);

    expect(front).toBe("$$x = \\underline{\\phantom{\\frac{-b}{2a}}}$$");
    expect(back).toBe("$$x = \\frac{-b}{2a}$$");
  });

  it("only blanks/reveals the target cloze index", () => {
    const input = "$$a={{c1::1}}+{{c2::2}}$$";

    const front = processClozeForMath(input, false, 1);
    const back = processClozeForMath(input, true, 1);

    expect(front).toBe("$$a=\\underline{\\phantom{1}}+2$$");
    expect(back).toBe("$$a=1+2$$");
  });

  it("uses markdown-style replacements outside math", () => {
    const input = "The identity is {{c1::true}}.";

    const front = processClozeForMath(input, false, null);
    const back = processClozeForMath(input, true, null);

    expect(front).toBe("The identity is <span class=\"sprout-cloze-blank hidden-cloze\" style=\"--learnkit-cloze-width:30px\"></span>.");
    expect(back).toBe("The identity is <span class=\"learnkit-cloze-revealed\">true</span>.");
  });

  it("shows the hint instead of a blank outside math", () => {
    const input = "Mnemonic: {{c1::Psoriatic arthritis::**P**}}.";

    const front = processClozeForMath(input, false, null);
    const back = processClozeForMath(input, true, null);

    expect(front).toBe("Mnemonic: <span class=\"learnkit-cloze-hint\" style=\"width:132px\">P</span>.");
    expect(back).toBe("Mnemonic: <span class=\"learnkit-cloze-revealed\">Psoriatic arthritis</span>.");
  });

  it("converts inline $$...$$ to $...$ when line has surrounding text", () => {
    const input = "Identity: $$\\sin^2 x + \\cos^2 x = {{c1::1}}$$ always.";
    const front = processClozeForMath(input, false, null);

    expect(front).toBe("Identity: $\\sin^2 x + \\cos^2 x = \\underline{\\phantom{1}}$ always.");
  });

  it("treats single-dollar inline math as math when replacing clozes", () => {
    const input = "Equation: $i_{1}+{{c1::1}}=0$.";

    const front = processClozeForMath(input, false, null);
    const back = processClozeForMath(input, true, null);

    expect(front).toBe("Equation: $i_{1}+\\underline{\\phantom{1}}=0$.");
    expect(back).toBe("Equation: $i_{1}+1=0$.");
  });

  it("keeps matrix line-break backslashes intact inside single-dollar math", () => {
    const input = "$\\begin{bmatrix}1&{{c1::1}}\\\\1&1\\end{bmatrix}$";

    const front = processClozeForMath(input, false, null);
    const back = processClozeForMath(input, true, null);

    expect(front).toBe("$\\begin{bmatrix}1&\\underline{\\phantom{1}}\\\\1&1\\end{bmatrix}$");
    expect(back).toBe("$\\begin{bmatrix}1&1\\\\1&1\\end{bmatrix}$");
  });

  it("normalizes multiline $$ blocks even when delimiters share lines with content", () => {
    const input = String.raw`$$ \begin{bmatrix}
1 & 1\\
1 & 1
\end{bmatrix} $$`;

    const output = convertInlineDisplayMath(input);

    expect(output).toBe(String.raw`$$
\begin{bmatrix}
1 & 1\\
1 & 1
\end{bmatrix}
$$`);
  });

  it("applies cloze replacements inside normalized multiline $$ blocks", () => {
    const input = String.raw`$$ \begin{bmatrix}
1 & {{c1::1}}\\
1 & 1
\end{bmatrix} $$`;

    const front = processClozeForMath(input, false, null);
    const back = processClozeForMath(input, true, null);

    expect(front).toBe(String.raw`$$
\begin{bmatrix}
1 & \underline{\phantom{1}}\\
1 & 1
\end{bmatrix}
$$`);
    expect(back).toBe(String.raw`$$
\begin{bmatrix}
1 & 1\\
1 & 1
\end{bmatrix}
$$`);
  });
});
