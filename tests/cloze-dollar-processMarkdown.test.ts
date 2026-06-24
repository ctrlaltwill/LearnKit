import { describe, expect, it } from "vitest";
import { buildReadingFlashcardCloze } from "../src/views/reading/reading-flashcard-cloze.ts";
import { formatDelimitedField } from "../src/platform/core/delimiter.ts";
import { parseCardsFromText } from "../src/engine/parser/parser.ts";
import { processClozeForMath, convertInlineDisplayMath } from "../src/platform/core/shared-utils.ts";

describe("GitHub #175: closing $$ positioning through buildReadingFlashcardCloze", () => {
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

  it("preserves closing $$ in buildReadingFlashcardCloze front", () => {
    const front = buildReadingFlashcardCloze(matrixCard, "front");
    console.log("FRONT (buildReadingFlashcardCloze):", JSON.stringify(front));
    const count = (front.match(/\$\$/g) || []).length;
    expect(count).toBe(2);
  });

  it("preserves closing $$ in buildReadingFlashcardCloze back", () => {
    const back = buildReadingFlashcardCloze(matrixCard, "back");
    console.log("BACK (buildReadingFlashcardCloze):", JSON.stringify(back));
    const count = (back.match(/\$\$/g) || []).length;
    expect(count).toBe(2);
  });

  it("output contains $$ delimiters at correct positions (front)", () => {
    const front = buildReadingFlashcardCloze(matrixCard, "front");
    // front should start with $$ and end with $$
    expect(front).toContain("$$");
    // $$ should come in pairs
    const first$$ = front.indexOf("$$");
    const last$$ = front.lastIndexOf("$$");
    expect(first$$).not.toBe(-1);
    expect(last$$).not.toBe(-1);
    // The first $$ should be before the last $$
    expect(first$$).toBeLessThan(last$$);
  });

  // ── FULL PIPELINE: format → parse → render → check $$ ──
  // Exact user card from pikatwinky's GitHub comment (NO $$ delimiters,
  // multiline matrix with cloze spanning multiple lines)
  const userRawCode = String.raw`\begin{bmatrix}
1 & 1\\
1&1
\end{bmatrix}+\begin{bmatrix}
0 \\
0
\end{bmatrix}={{c1:: \begin{bmatrix}
1 \\
1
\end{bmatrix}
}}`;

  it("reproduces exact formatDelimitedField output for user card (no $$)", () => {
    const formatted = formatDelimitedField("CQ", userRawCode);
    console.log("FORMATTED (no $$):");
    formatted.forEach((l, i) => console.log(`  [${i}] ${JSON.stringify(l)}`));

    // Last line should be }} | (cloze close then delimiter)
    const last = formatted[formatted.length - 1];
    expect(last).toContain("}}");
    expect(last).toContain("|");
    // The $$ should NOT appear (user didn't add it)
    expect(formatted.join("\n")).not.toContain("$$");
  });

  it("preserves $$ through format→parse→render pipeline ($$ inside cloze)", () => {
    // User manually wraps with $$ after card creation
    const withDollars = `$$\n${userRawCode}\n$$`;
    const formatted = formatDelimitedField("CQ", withDollars);
    console.log("FORMATTED (with $$):");
    formatted.forEach((l, i) => console.log(`  [${i}] ${JSON.stringify(l)}`));

    // Parse back: build a minimal card block & parse it
    const blockSource = ["^sprout-test123", ...formatted, ""].join("\n");
    console.log("BLOCK SOURCE:", JSON.stringify(blockSource));

    const { cards: parsed } = parseCardsFromText("test/note.md", blockSource);
    console.log("PARSED cards:", parsed.length);
    if (parsed.length) {
      const rec = parsed[0];
      const cq = rec.clozeText ?? "";
      console.log("PARSED CQ:", JSON.stringify(cq));

      // $$ pair count
      const dollarCount = (cq.match(/\$\$/g) || []).length;
      console.log("$$ count in parsed CQ:", dollarCount);
      expect(dollarCount).toBe(2);

      // Now run through buildReadingFlashcardCloze
      const front = buildReadingFlashcardCloze(cq, "front");
      console.log("FRONT:", JSON.stringify(front));
      const frontDollarCount = (front.match(/\$\$/g) || []).length;
      console.log("$$ count in front:", frontDollarCount);
      expect(frontDollarCount).toBe(2);

      const back = buildReadingFlashcardCloze(cq, "back");
      console.log("BACK:", JSON.stringify(back));
      const backDollarCount = (back.match(/\$\$/g) || []).length;
      console.log("$$ count in back:", backDollarCount);
      expect(backDollarCount).toBe(2);
    }
  });

  it("checks what processClozeForMath does with multiline cloze at end of $$ block", () => {
    const withDollars = `$$\n${userRawCode}\n$$`;
    const front = processClozeForMath(withDollars, false, null, {
      blankClassName: "test-blank",
    });
    console.log("processClozeForMath FRONT:", JSON.stringify(front));
    const dollarCount = (front.match(/\$\$/g) || []).length;
    expect(dollarCount).toBe(2);

    const back = processClozeForMath(withDollars, true, null, {
      blankClassName: "test-blank",
    });
    console.log("processClozeForMath BACK:", JSON.stringify(back));
    const backDollarCount = (back.match(/\$\$/g) || []).length;
    expect(backDollarCount).toBe(2);
  });

  it("checks convertInlineDisplayMath on $$ block with cloze close on last line", () => {
    // Simulate $$ block where the }} is on the last line before closing $$
    const withDollarsEnd = String.raw`$$
\begin{bmatrix}
1 & 1\\
1&1
\end{bmatrix}+\begin{bmatrix}
0 \\
0
\end{bmatrix}={{c1:: \begin{bmatrix}
1 \\
1
\end{bmatrix}
}}$$`;
    console.log("INPUT:", JSON.stringify(withDollarsEnd));
    const result = convertInlineDisplayMath(withDollarsEnd);
    console.log("OUTPUT:", JSON.stringify(result));
    const dollarCount = (result.match(/\$\$/g) || []).length;
    expect(dollarCount).toBe(2);
    // $$ should be at the very end
    expect(result).toMatch(/\$\$$/);
  });
});
