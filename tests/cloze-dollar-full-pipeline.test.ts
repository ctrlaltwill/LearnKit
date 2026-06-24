import { describe, expect, it } from "vitest";
import { formatDelimitedField, setDelimiter, getDelimiter, unescapeDelimiterText, stripClosingDelimiter } from "../src/platform/core/delimiter";
import { processClozeForMath } from "../src/platform/core/shared-utils";

describe("Full pipeline: format → parse → process", () => {
  it("$$ matrix card round-trips correctly ($$ on own lines)", () => {
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

    // Step 1: Format
    const formatted = formatDelimitedField("CQ", input);
    console.log("FORMATTED:", JSON.stringify(formatted.join("\n")));

    // Step 2: Simulate parsing (extract field content from formatted lines)
    let clozeText = "";
    let inField = false;
    for (const line of formatted) {
      if (!inField) {
        // First line: "CQ | <content>"
        const match = line.match(/^CQ\s*\|\s*(.*)$/);
        if (match) {
          clozeText = unescapeDelimiterText(match[1] ?? "");
          inField = true;
          // Check if this line also closes
          const { text, closed } = stripClosingDelimiter(line.replace(/^CQ\s*\|\s*/, ""));
          if (closed) break;
        }
      } else {
        const { text, closed } = stripClosingDelimiter(line);
        const chunk = unescapeDelimiterText(text);
        clozeText += "\n" + chunk;
        if (closed) break;
      }
    }
    
    console.log("PARSED:", JSON.stringify(clozeText));

    // Step 3: Process cloze for math
    const front = processClozeForMath(clozeText, false, null);
    const back = processClozeForMath(clozeText, true, null);

    console.log("FRONT:", JSON.stringify(front));
    console.log("BACK:", JSON.stringify(back));

    // Verify $$ pairs are preserved
    expect((front.match(/\$\$/g) || []).length).toBe(2);
    expect((back.match(/\$\$/g) || []).length).toBe(2);
  });

  it("$$ matrix card round-trips correctly ($$ on same line)", () => {
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

    const formatted = formatDelimitedField("CQ", input);
    
    let clozeText = "";
    let inField = false;
    for (const line of formatted) {
      if (!inField) {
        const match = line.match(/^CQ\s*\|\s*(.*)$/);
        if (match) {
          clozeText = unescapeDelimiterText(match[1] ?? "");
          inField = true;
          const { text, closed } = stripClosingDelimiter(line.replace(/^CQ\s*\|\s*/, ""));
          if (closed) break;
        }
      } else {
        const { text, closed } = stripClosingDelimiter(line);
        const chunk = unescapeDelimiterText(text);
        clozeText += "\n" + chunk;
        if (closed) break;
      }
    }
    
    console.log("PARSED (same-line):", JSON.stringify(clozeText));

    const front = processClozeForMath(clozeText, false, null);
    console.log("FRONT (same-line):", JSON.stringify(front));

    expect((front.match(/\$\$/g) || []).length).toBe(2);
  });
});
