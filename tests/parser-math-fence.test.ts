import { beforeEach, describe, expect, it } from "vitest";

import { parseCardsFromText } from "../src/engine/parser/parser";
import { formatDelimitedField, setDelimiter } from "../src/platform/core/delimiter";

const ANCHOR = "^learnkit-123456789";

describe("parser $$ fence protection", () => {
  beforeEach(() => {
    setDelimiter("|");
  });

  it("parses multi-line $$ math with norm bars as a single field", () => {
    const src = [
      ANCHOR,
      "Q | $$",
      String.raw`\left| x \right|`,
      "$$",
      "|",
      "A | 10 |",
    ].join("\n");

    const { cards } = parseCardsFromText("note.md", src);

    expect(cards).toHaveLength(1);
    expect(cards[0].q).toBe(
      [String.raw`$$`, String.raw`\left| x \right|`, String.raw`$$`].join("\n"),
    );
    expect(cards[0].a).toBe("10");
    expect(cards[0].errors).toEqual([]);
  });

  it("parses a multi-line matrix with a trailing norm bar without truncation", () => {
    const src = [
      ANCHOR,
      "Q | Compute the determinant:",
      "$$",
      String.raw`\begin{vmatrix}`,
      String.raw`1 & 2 \\`,
      String.raw`3 & 4`,
      String.raw`\end{vmatrix}`,
      "$$",
      "|",
      "A | 10 |",
    ].join("\n");

    const { cards } = parseCardsFromText("note.md", src);

    expect(cards).toHaveLength(1);
    expect(cards[0].q).toBe(
      [
        "Compute the determinant:",
        "$$",
        String.raw`\begin{vmatrix}`,
        String.raw`1 & 2 \\`,
        String.raw`3 & 4`,
        String.raw`\end{vmatrix}`,
        "$$",
      ].join("\n"),
    );
    expect(cards[0].a).toBe("10");
  });

  it("round-trips a $$ fence card byte-identically", () => {
    const q = [String.raw`$$`, String.raw`\left| x \right|`, String.raw`$$`].join("\n");
    const a = "10";

    const serialized = [
      ANCHOR,
      ...formatDelimitedField("Q", q),
      ...formatDelimitedField("A", a),
    ].join("\n");

    const { cards } = parseCardsFromText("note.md", serialized);

    expect(cards).toHaveLength(1);

    const roundTrip = [
      ANCHOR,
      ...formatDelimitedField("Q", cards[0].q ?? ""),
      ...formatDelimitedField("A", cards[0].a ?? ""),
    ].join("\n");

    expect(roundTrip).toBe(serialized);
  });

  it("still terminates a normal multiline field on its trailing delimiter", () => {
    const src = [
      ANCHOR,
      "Q | First line",
      "Second line |",
      "A | 10 |",
    ].join("\n");

    const { cards } = parseCardsFromText("note.md", src);

    expect(cards).toHaveLength(1);
    expect(cards[0].q).toBe("First line\nSecond line");
    expect(cards[0].a).toBe("10");
  });
});
