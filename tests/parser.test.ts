/**
 * @file tests/parser.test.ts
 * @summary Unit tests for parser.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

// tests/parser.test.ts
// ---------------------------------------------------------------------------
// Tests for the card parser — ensures all card formats (basic, MCQ, cloze, IO)
// parse correctly and that errors are caught for malformed input.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parseCardsFromText } from "../src/engine/parser/parser";
import type { ParseCardsFromTextOptions, ParsedCard } from "../src/engine/parser/parser";
import { preprocessSrText, isMarkdownHeading, ANY_HEADER_DELIM_RE } from "../src/platform/core/delimiter";

// ── Helpers ─────────────────────────────────────────────────────────────────

function parse(text: string, options?: ParseCardsFromTextOptions): ParsedCard[] {
  // Pre-process SR multi-line blocks so the parser sees :: / ::: shorthand.
  // This is a no-op when no SR markers are present.
  const processed = preprocessSrText(text, true, (ln: string) =>
    ANY_HEADER_DELIM_RE().test(ln) || isMarkdownHeading(ln),
  );
  return parseCardsFromText("test-note.md", processed, true, options).cards;
}

function parseOne(text: string): ParsedCard {
  const cards = parse(text);
  expect(cards).toHaveLength(1);
  return cards[0];
}

// ── Basic cards ─────────────────────────────────────────────────────────────

describe("basic cards (Q/A)", () => {
  it("parses a simple Q/A card", () => {
    const card = parseOne(
      `Q | What is 2+2? |
A | 4 |`
    );

    expect(card.type).toBe("basic");
    expect(card.q).toBe("What is 2+2?");
    expect(card.a).toBe("4");
    expect(card.errors).toHaveLength(0);
  });

  it("parses multiline question and answer", () => {
    const card = parseOne(
      `Q | What is the capital
of France? |
A | Paris is the capital
of France. |`
    );

    expect(card.q).toContain("France");
    expect(card.a).toContain("Paris");
    expect(card.errors).toHaveLength(0);
  });

  it("errors on missing answer", () => {
    const card = parseOne(`Q | What is 2+2? |`);

    expect(card.type).toBe("basic");
    expect(card.errors.length).toBeGreaterThan(0);
    expect(card.errors.some((e) => /missing.*a/i.test(e))).toBe(true);
  });

  it("attaches an anchor id when present", () => {
    const card = parseOne(
      `^sprout-123456789
Q | Question |
A | Answer |`
    );

    expect(card.id).toBe("123456789");
    expect(card.errors).toHaveLength(0);
  });

  it("parses title field", () => {
    const card = parseOne(
      `T | My Title |
Q | Question |
A | Answer |`
    );

    expect(card.title).toBe("My Title");
  });

  it("parses groups field", () => {
    const card = parseOne(
      `Q | Question |
A | Answer |
G | Math/Algebra, Science |`
    );

    expect(card.groups).toEqual(["Math/Algebra", "Science"]);
  });

  it("sorts and deduplicates groups alphabetically", () => {
    const card = parseOne(
      `Q | Question |
A | Answer |
G | Rheumatology, Musculoskeletal, Clinical Tests, Rheumatology |`
    );

    expect(card.groups).toEqual(["Clinical Tests", "Musculoskeletal", "Rheumatology"]);
  });

  it("deduplicates groups case-insensitively using the most common casing", () => {
    const card = parseOne(
      `Q | Question |
A | Answer |
G | anking, AnKing, Anking, AnKing, Emergency medicine, Emergency Medicine, Emergency Medicine |`
    );

    expect(card.groups).toEqual(["AnKing", "Emergency Medicine"]);
  });

  it("normalizes :: group hierarchies to slash-delimited paths", () => {
    const card = parseOne(
      `Q | Question |
A | Answer |
G | A/B, A::C |`
    );

    expect(card.groups).toEqual(["A/B", "A/C"]);
  });
});

// ── MCQ cards ───────────────────────────────────────────────────────────────

describe("MCQ cards", () => {
  it("parses a well-formed MCQ with wrong/correct options", () => {
    const card = parseOne(
      `MCQ | What color is the sky? |
A | Blue |
O | Red |
O | Green |`
    );

    expect(card.type).toBe("mcq");
    expect(card.stem).toBe("What color is the sky?");
    expect(card.errors).toHaveLength(0);
    expect(card.options).toBeDefined();
    expect(card.options!.length).toBe(3);
    expect(card.options!.find((o) => o.isCorrect)?.text).toBe("Blue");
  });

  it("errors when no correct answer is provided", () => {
    const card = parseOne(
      `MCQ | Stem? |
O | Wrong1 |
O | Wrong2 |`
    );

    expect(card.errors.length).toBeGreaterThan(0);
  });

  it("errors when no wrong options are provided", () => {
    const card = parseOne(
      `MCQ | Stem? |
A | Correct |`
    );

    expect(card.errors.length).toBeGreaterThan(0);
  });

  it("parses a multi-answer MCQ with multiple A | lines", () => {
    const card = parseOne(
      `MCQ | Which are primary colors? |
A | Red |
A | Blue |
O | Green |
O | Purple |`
    );

    expect(card.type).toBe("mcq");
    expect(card.stem).toBe("Which are primary colors?");
    expect(card.errors).toHaveLength(0);
    expect(card.options).toBeDefined();
    expect(card.options!.length).toBe(4);
    const corrects = card.options!.filter((o) => o.isCorrect);
    expect(corrects.length).toBe(2);
    expect(corrects.map((o) => o.text).sort()).toEqual(["Blue", "Red"]);
    const wrongs = card.options!.filter((o) => !o.isCorrect);
    expect(wrongs.length).toBe(2);
    expect(wrongs.map((o) => o.text).sort()).toEqual(["Green", "Purple"]);
  });

  it("multi-answer MCQ places correct options first in canonical order", () => {
    const card = parseOne(
      `MCQ | Pick the evens |
O | 1 |
A | 2 |
O | 3 |
A | 4 |`
    );

    expect(card.errors).toHaveLength(0);
    // Corrects first, wrongs after
    expect(card.options![0]).toEqual({ text: "2", isCorrect: true });
    expect(card.options![1]).toEqual({ text: "4", isCorrect: true });
    expect(card.options![2]).toEqual({ text: "1", isCorrect: false });
    expect(card.options![3]).toEqual({ text: "3", isCorrect: false });
  });
});

// ── Cloze cards ─────────────────────────────────────────────────────────────

describe("cloze cards", () => {
  it("parses a single cloze deletion", () => {
    const card = parseOne(`CQ | The {{c1::sun}} rises in the east. |`);

    expect(card.type).toBe("cloze");
    expect(card.clozeText).toContain("{{c1::sun}}");
    expect(card.errors).toHaveLength(0);
  });

  it("parses multiple cloze deletions", () => {
    const card = parseOne(
      `CQ | {{c1::Paris}} is the capital of {{c2::France}}. |`
    );

    expect(card.type).toBe("cloze");
    expect(card.clozeText).toContain("{{c1::Paris}}");
    expect(card.clozeText).toContain("{{c2::France}}");
    expect(card.errors).toHaveLength(0);
  });

  it("parses a cloze deletion with hint syntax", () => {
    const card = parseOne(
      `CQ | {{c1::Psoriatic arthritis::**P**}} is one item in PEAR. |`
    );

    expect(card.type).toBe("cloze");
    expect(card.clozeText).toContain("{{c1::Psoriatic arthritis::**P**}}");
    expect(card.errors).toHaveLength(0);
  });

  it("errors when no cloze tokens are present", () => {
    const card = parseOne(`CQ | No cloze here. |`);

    expect(card.errors.length).toBeGreaterThan(0);
    expect(card.errors.some((e) => /cloze/i.test(e))).toBe(true);
  });

  it("errors on empty cloze content", () => {
    const card = parseOne(`CQ | The {{c1::}} is empty. |`);

    expect(card.errors.length).toBeGreaterThan(0);
  });

  it("keeps malformed unclosed clozes on the legacy generic error path", () => {
    const card = parseOne(`CQ | The {{c1::sun rises in the east. |`);

    expect(card.errors).toContain("Cloze card requires at least one {{cN::...}} token.");
  });

  it("parses a multi-line cloze deletion", () => {
    const card = parseOne(
      `CQ | What findings indicate a hemorrhagic stroke?

{{c1::
Pinpoint pupils
Loss of horizontal gaze
}} |`
    );

    expect(card.type).toBe("cloze");
    expect(card.clozeText).toContain("{{c1::");
    expect(card.clozeText).toContain("Pinpoint pupils");
    expect(card.clozeText).toContain("Loss of horizontal gaze");
    expect(card.errors).toHaveLength(0);
  });

  it("parses a multi-line cloze with anchor and title", () => {
    const card = parseOne(
      `^sprout-837047008
T| Neurology |
CQ| In addition to scopolamine, which drugs treat vestibular nausea?

{{c1::
Meclizine
Dimenhydrinate
Diphenhydramine
}} |`
    );

    expect(card.type).toBe("cloze");
    expect(card.id).toBe("837047008");
    expect(card.title).toBe("Neurology");
    expect(card.clozeText).toContain("Meclizine");
    expect(card.clozeText).toContain("Dimenhydrinate");
    expect(card.clozeText).toContain("Diphenhydramine");
    expect(card.errors).toHaveLength(0);
  });

  it("parses multiple multi-line cloze deletions in one card", () => {
    const card = parseOne(
      `CQ | Symptom A: {{c1::
line1
line2
}} and Symptom B: {{c2::
line3
line4
}} |`
    );

    expect(card.type).toBe("cloze");
    expect(card.clozeText).toContain("line1");
    expect(card.clozeText).toContain("line4");
    expect(card.errors).toHaveLength(0);
  });

  it("preserves raw LaTeX matrix row breaks in cloze fields", () => {
    const card = parseOne(
      `CQ | $$
\\begin{bmatrix}
1 & 1\\\\
1 & {{c1::1}}
\\end{bmatrix}
$$ |`
    );

    expect(card.type).toBe("cloze");
    expect(card.clozeText).toContain("\\begin{bmatrix}");
    expect(card.clozeText).toContain("1 & 1\\\\");
    expect(card.clozeText).toContain("\\end{bmatrix}");
    expect(card.errors).toHaveLength(0);
  });

  it("parses multiline cloze math when closing delimiter is on its own line", () => {
    const card = parseOne(
      `CQ | $$
\\begin{bmatrix}
1 & 1\\\\
1 & {{c1::1}}
\\end{bmatrix}
$$
|`
    );

    expect(card.type).toBe("cloze");
    expect(card.clozeText).toContain("\\begin{bmatrix}");
    expect(card.clozeText).toContain("1 & 1\\\\");
    expect(card.clozeText).toContain("\\end{bmatrix}");
    expect(card.errors).toHaveLength(0);
  });

  it("decodes legacy escaped LaTeX matrix content written by older save flows", () => {
    const card = parseOne(
      `CQ | $$
\\\\begin{bmatrix}
1 & 1\\\\\\\\
1 & {{c1::1}}
\\\\end{bmatrix}
$$ |`
    );

    expect(card.type).toBe("cloze");
    expect(card.clozeText).toContain("\\begin{bmatrix}");
    expect(card.clozeText).toContain("1 & 1\\\\");
    expect(card.clozeText).toContain("\\end{bmatrix}");
    expect(card.errors).toHaveLength(0);
  });
});

// ── IO cards ────────────────────────────────────────────────────────────────

describe("IO cards", () => {
  it("parses a basic IO card with image embed", () => {
    const card = parseOne(`IO | ![[diagram.png]] |`);

    expect(card.type).toBe("io");
    expect(card.ioSrc).toContain("![[diagram.png]]");
    expect(card.errors).toHaveLength(0);
  });

  it("parses an IO card whose filename contains spaces", () => {
    const card = parseOne(`IO | ![[Ankylosing Spondylitis - Schrober Test.png]] |`);

    expect(card.type).toBe("io");
    expect(card.ioSrc).toContain("Ankylosing Spondylitis - Schrober Test.png");
    expect(card.errors).toHaveLength(0);
  });

  it("errors when no image embed is present", () => {
    const card = parseOne(`IO | just some text |`);

    expect(card.errors.length).toBeGreaterThan(0);
    expect(card.errors.some((e) => /image/i.test(e))).toBe(true);
  });

  it("parses IO with a prompt", () => {
    const card = parseOne(
      `IO | ![[diagram.png]] |
Q | Label the parts |`
    );

    expect(card.prompt).toBe("Label the parts");
    expect(card.errors).toHaveLength(0);
  });
});

describe("HQ cards", () => {
  it("parses a basic HQ card with image embed", () => {
    const card = parseOne(`HQ | ![[diagram.png]] |`);

    expect(card.type).toBe("hq");
    expect(card.hqSrc).toContain("![[diagram.png]]");
    expect(card.errors).toHaveLength(0);
  });

  it("parses HQ regions and interaction mode", () => {
    const card = parseOne(
      `HQ | ![[diagram.png]] |
Q | Click on the ulna |
O | [{"rectId":"r1","x":0.2,"y":0.1,"w":0.15,"h":0.25,"groupKey":"Ulna","shape":"rect"}] |
M | click |`
    );

    expect(card.type).toBe("hq");
    expect(card.prompt).toBe("Click on the ulna");
    expect(card.interactionMode).toBe("click");
    expect(card.hqRegions).toEqual([
      {
        rectId: "r1",
        x: 0.2,
        y: 0.1,
        w: 0.15,
        h: 0.25,
        groupKey: "Ulna",
        shape: "rect",
      },
    ]);
    expect(card.errors).toHaveLength(0);
  });

  it("errors when HQ interaction mode is invalid", () => {
    const card = parseOne(
      `HQ | ![[diagram.png]] |
M | tap |`
    );

    expect(card.errors).toContain('HQ interaction mode must be "click" or "drag-drop".');
  });
});

// ── Multiple cards in one block ─────────────────────────────────────────────

describe("multiple cards", () => {
  it("parses multiple cards separated by blank lines", () => {
    const cards = parse(
      `Q | Question 1 |
A | Answer 1 |

Q | Question 2 |
A | Answer 2 |

CQ | The {{c1::sun}} sets. |`
    );

    expect(cards).toHaveLength(3);
    expect(cards[0].type).toBe("basic");
    expect(cards[1].type).toBe("basic");
    expect(cards[2].type).toBe("cloze");
  });

  it("assigns different anchors to different cards", () => {
    const cards = parse(
      `^sprout-111111111
Q | Q1 |
A | A1 |

^sprout-222222222
Q | Q2 |
A | A2 |`
    );

    expect(cards).toHaveLength(2);
    expect(cards[0].id).toBe("111111111");
    expect(cards[1].id).toBe("222222222");
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("returns empty array for empty text", () => {
    expect(parse("")).toHaveLength(0);
  });

  it("returns empty array for text with no cards", () => {
    expect(parse("Just some regular markdown notes.\n\nNothing to see here.")).toHaveLength(0);
  });

  it("ignores content inside fenced code blocks", () => {
    const cards = parse(
      `\`\`\`
Q | This is inside a fence |
A | Should be ignored |
\`\`\`

Q | Real card |
A | Real answer |`
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].q).toBe("Real card");
  });

  it("parses code fences inside a multi-line CQ field", () => {
    const cards = parse(
      `^learnkit-000000001
CQ |
\`\`\`
print("Hello {{c1::World}}")
\`\`\`
|`
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("cloze");
    expect(cards[0].clozeText).toContain("```");
    expect(cards[0].clozeText).toContain('print("Hello {{c1::World}}")');
    expect(cards[0].errors).toHaveLength(0);
  });

  it("parses code fences inside a multi-line Q field", () => {
    const cards = parse(
      `^learnkit-000000002
Q |
\`\`\`python
print("hello")
\`\`\`
|
A | It prints hello |
T | Code question |`
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("basic");
    expect(cards[0].q).toContain("```python");
    expect(cards[0].q).toContain('print("hello")');
    expect(cards[0].a).toBe("It prints hello");
    expect(cards[0].errors).toHaveLength(0);
  });
});

// ── Shorthand basic cards (::) ──────────────────────────────────────────────

describe("shorthand basic cards (::)", () => {
  it("parses a simple shorthand card", () => {
    const card = parseOne("Capital of France::Paris");
    expect(card.type).toBe("basic");
    expect(card.q).toBe("Capital of France");
    expect(card.a).toBe("Paris");
    expect(card.isShorthand).toBe(true);
    expect(card.errors).toHaveLength(0);
  });

  it("trims whitespace around question and answer", () => {
    const card = parseOne("  What is 2+2  ::  4  ");
    expect(card.q).toBe("What is 2+2");
    expect(card.a).toBe("4");
    expect(card.isShorthand).toBe(true);
    expect(card.errors).toHaveLength(0);
  });

  it("splits on the first :: only", () => {
    const card = parseOne("Q::A::B");
    expect(card.q).toBe("Q");
    expect(card.a).toBe("A::B");
  });

  it("rejects empty question (::Answer)", () => {
    const cards = parse("::Answer");
    expect(cards).toHaveLength(0);
  });

  it("rejects empty answer (Question::)", () => {
    const cards = parse("Question::");
    expect(cards).toHaveLength(0);
  });

  it("rejects empty question after trim", () => {
    const cards = parse("   ::Answer");
    expect(cards).toHaveLength(0);
  });

  it("rejects empty answer after trim", () => {
    const cards = parse("Question::   ");
    expect(cards).toHaveLength(0);
  });

  it("does not interfere with existing card-start patterns", () => {
    const card = parseOne("Q | What is 2+2? |\nA | 4 |");
    expect(card.type).toBe("basic");
    expect(card.isShorthand).toBe(false);
    expect(card.q).toBe("What is 2+2?");
  });

  it("parses multiple consecutive shorthand cards", () => {
    const cards = parse("Q1::A1\nQ2::A2\nQ3::A3");
    expect(cards).toHaveLength(3);
    expect(cards[0].q).toBe("Q1");
    expect(cards[0].a).toBe("A1");
    expect(cards[1].q).toBe("Q2");
    expect(cards[2].q).toBe("Q3");
    cards.forEach((c) => expect(c.isShorthand).toBe(true));
  });

  it("parses shorthand cards mixed with regular cards", () => {
    const cards = parse(
      `Q | Regular Q |
A | Regular A |

Shorthand Q::Shorthand A`
    );
    expect(cards).toHaveLength(2);
    expect(cards[0].type).toBe("basic");
    expect(cards[0].isShorthand).toBe(false);
    expect(cards[0].q).toBe("Regular Q");
    expect(cards[1].type).toBe("basic");
    expect(cards[1].isShorthand).toBe(true);
    expect(cards[1].q).toBe("Shorthand Q");
    expect(cards[1].a).toBe("Shorthand A");
  });

  it("attaches a pending anchor ID to a shorthand card", () => {
    const card = parseOne("^sprout-123456789\nCapital::Paris");
    expect(card.id).toBe("123456789");
    expect(card.q).toBe("Capital");
    expect(card.a).toBe("Paris");
    expect(card.isShorthand).toBe(true);
    expect(card.errors).toHaveLength(0);
  });

  it("attaches a pending title to a shorthand card", () => {
    const card = parseOne("T | Geography |\nCapital::Paris");
    expect(card.title).toBe("Geography");
    expect(card.q).toBe("Capital");
    expect(card.a).toBe("Paris");
    expect(card.isShorthand).toBe(true);
  });

  it("flushes current card when shorthand line is encountered", () => {
    const cards = parse(
      `Q | Ongoing Q |
A | Ongoing A |
Shorthand::Answer`
    );
    expect(cards).toHaveLength(2);
    expect(cards[0].q).toBe("Ongoing Q");
    expect(cards[1].q).toBe("Shorthand");
    expect(cards[1].isShorthand).toBe(true);
  });
});

// ── Shorthand reversed cards (:::) ──────────────────────────────────────────

describe("shorthand reversed cards (:::)", () => {
  it("parses a simple reversed shorthand card", () => {
    const card = parseOne("Capital of France:::Paris");
    expect(card.type).toBe("reversed");
    expect(card.q).toBe("Capital of France");
    expect(card.a).toBe("Paris");
    expect(card.isShorthand).toBe(true);
    expect(card.errors).toHaveLength(0);
  });

  it("trims whitespace around question and answer", () => {
    const card = parseOne("  What is 2+2  :::  4  ");
    expect(card.type).toBe("reversed");
    expect(card.q).toBe("What is 2+2");
    expect(card.a).toBe("4");
    expect(card.isShorthand).toBe(true);
  });

  it("does not conflict with basic double-colon", () => {
    // Verify that :: is still basic and ::: is now reversed
    const basic = parseOne("Q::A");
    expect(basic.type).toBe("basic");
    const reversed = parseOne("Q:::A");
    expect(reversed.type).toBe("reversed");
  });

  it("rejects empty question (:::Answer)", () => {
    const cards = parse(":::Answer");
    expect(cards).toHaveLength(0);
  });

  it("rejects empty answer (Question:::)", () => {
    const cards = parse("Question:::");
    expect(cards).toHaveLength(0);
  });

  it("does not match inside fenced code blocks", () => {
    const cards = parse(
      `\`\`\`
Question:::Answer
\`\`\``
    );
    expect(cards).toHaveLength(0);
  });

  it("parses multiple consecutive reversed shorthand cards", () => {
    const cards = parse("Q1:::A1\nQ2:::A2\nQ3:::A3");
    expect(cards).toHaveLength(3);
    expect(cards[0].type).toBe("reversed");
    expect(cards[0].q).toBe("Q1");
    expect(cards[0].a).toBe("A1");
    cards.forEach((c) => expect(c.isShorthand).toBe(true));
  });

  it("parses reversed shorthand mixed with basic shorthand", () => {
    const cards = parse("Basic Q::Basic A\nReversed Q:::Reversed A");
    expect(cards).toHaveLength(2);
    expect(cards[0].type).toBe("basic");
    expect(cards[1].type).toBe("reversed");
  });

  it("attaches a pending anchor ID to a reversed shorthand card", () => {
    const card = parseOne("^learnkit-123456789\nQ Side:::A Side");
    expect(card.id).toBe("123456789");
    expect(card.type).toBe("reversed");
    expect(card.q).toBe("Q Side");
    expect(card.a).toBe("A Side");
    expect(card.isShorthand).toBe(true);
  });

  it("attaches a pending title to a reversed shorthand card", () => {
    const card = parseOne("T | Geography |\nCapital:::Paris");
    expect(card.title).toBe("Geography");
    expect(card.type).toBe("reversed");
    expect(card.q).toBe("Capital");
    expect(card.a).toBe("Paris");
    expect(card.isShorthand).toBe(true);
  });
});

// ── Shorthand cloze cards (cloze/cq/CQ::) ───────────────────────────────────

describe("shorthand cloze cards (::)", () => {
  it("parses cloze:: with bare {{}} tokens and auto-numbers them", () => {
    const card = parseOne("cloze::The capital of {{France}} is {{Paris}}");
    expect(card.type).toBe("cloze");
    expect(card.clozeText).toBe("The capital of {{c1::France}} is {{c2::Paris}}");
    expect(card.isShorthand).toBe(true);
    expect(card.errors).toHaveLength(0);
  });

  it("accepts cq:: prefix (lowercase)", () => {
    const card = parseOne("cq::The answer is {{42}}");
    expect(card.type).toBe("cloze");
    expect(card.clozeText).toBe("The answer is {{c1::42}}");
    expect(card.isShorthand).toBe(true);
    expect(card.errors).toHaveLength(0);
  });

  it("accepts CQ:: prefix (uppercase)", () => {
    const card = parseOne("CQ::The answer is {{42}}");
    expect(card.type).toBe("cloze");
    expect(card.clozeText).toBe("The answer is {{c1::42}}");
    expect(card.isShorthand).toBe(true);
    expect(card.errors).toHaveLength(0);
  });

  it("accepts Cloze:: prefix (mixed case)", () => {
    const card = parseOne("Cloze::The answer is {{42}}");
    expect(card.type).toBe("cloze");
    expect(card.clozeText).toBe("The answer is {{c1::42}}");
    expect(card.isShorthand).toBe(true);
  });

  it("preserves already-numbered {{cN::}} tokens", () => {
    const card = parseOne("cloze::{{c3::alpha}} and {{c1::beta}}");
    expect(card.clozeText).toBe("{{c3::alpha}} and {{c1::beta}}");
    expect(card.errors).toHaveLength(0);
  });

  it("auto-numbers bare tokens and preserves numbered ones", () => {
    const card = parseOne("cq::{{c1::known}} then {{unknown}} then {{also unknown}}");
    expect(card.clozeText).toBe("{{c1::known}} then {{c2::unknown}} then {{c3::also unknown}}");
  });

  it("rejects empty body", () => {
    const cards = parse("cloze::");
    expect(cards).toHaveLength(0);
  });

  it("rejects body with no cloze tokens", () => {
    const card = parseOne("cloze::no tokens here");
    expect(card.type).toBe("cloze");
    expect(card.errors.length).toBeGreaterThan(0);
  });

  it("rejects empty cloze token content", () => {
    const card = parseOne("cloze::text with {{}}");
    expect(card.errors.length).toBeGreaterThan(0);
  });

  it("does not interfere with basic shorthand", () => {
    const basic = parseOne("What is 2+2::4");
    expect(basic.type).toBe("basic");
    expect(basic.q).toBe("What is 2+2");
    expect(basic.a).toBe("4");
    const cloze = parseOne("cloze::What is {{answer}}");
    expect(cloze.type).toBe("cloze");
    expect(cloze.clozeText).toBe("What is {{c1::answer}}");
  });

  it("does not match inside fenced code blocks", () => {
    const cards = parse(
      `\`\`\`
cloze::text with {{hidden}}
\`\`\``
    );
    expect(cards).toHaveLength(0);
  });

  it("attaches a pending anchor ID", () => {
    const card = parseOne("^learnkit-123456789\ncloze::The capital is {{Paris}}");
    expect(card.id).toBe("123456789");
    expect(card.type).toBe("cloze");
    expect(card.clozeText).toBe("The capital is {{c1::Paris}}");
    expect(card.isShorthand).toBe(true);
  });

  it("attaches a pending title", () => {
    const card = parseOne("T | Geography |\ncq::The capital is {{Paris}}");
    expect(card.title).toBe("Geography");
    expect(card.type).toBe("cloze");
    expect(card.clozeText).toBe("The capital is {{c1::Paris}}");
  });

  it("parses multiple consecutive cloze shorthand cards", () => {
    const cards = parse("cloze::{{A}} is A\ncq::{{B}} is B");
    expect(cards).toHaveLength(2);
    expect(cards[0].clozeText).toBe("{{c1::A}} is A");
    expect(cards[1].clozeText).toBe("{{c1::B}} is B");
    cards.forEach((c) => {
      expect(c.type).toBe("cloze");
      expect(c.isShorthand).toBe(true);
    });
  });

  it("parses cloze shorthand mixed with basic shorthand", () => {
    const cards = parse("Q::A\ncloze::text {{hidden}}");
    expect(cards).toHaveLength(2);
    expect(cards[0].type).toBe("basic");
    expect(cards[1].type).toBe("cloze");
    expect(cards[1].clozeText).toBe("text {{c1::hidden}}");
  });
});

describe("shorthand parsing modes", () => {
  it("ignores shorthand when shorthandMode is off", () => {
    const cards = parse("Capital::Paris", { shorthandMode: "off" });
    expect(cards).toHaveLength(0);
  });

  it("parses only anchored shorthand when shorthandMode is anchored-only", () => {
    const cards = parse(
      [
        "Capital::Paris",
        "",
        "^learnkit-123456789",
        "HQ:::High quality",
      ].join("\n"),
      { shorthandMode: "anchored-only" },
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe("123456789");
    expect(cards[0].type).toBe("reversed");
    expect(cards[0].q).toBe("HQ");
    expect(cards[0].a).toBe("High quality");
    expect(cards[0].isShorthand).toBe(true);
  });
});

// ── SR migration: multi-line basic / reversed (?, ??) ──────────────────────

describe("SR multi-line migration (?, ??)", () => {
  it("converts multi-line basic (?) to basic card", () => {
    const cards = parse("What is the capital\n?\nParis");
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("basic");
    expect(cards[0].q).toBe("What is the capital");
    expect(cards[0].a).toBe("Paris");
    expect(cards[0].isShorthand).toBe(true);
  });

  it("converts multi-line reversed (??) to reversed card", () => {
    const cards = parse("info 1A\n??\ninfo 2A");
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("reversed");
    expect(cards[0].q).toBe("info 1A");
    expect(cards[0].a).toBe("info 2A");
    expect(cards[0].isShorthand).toBe(true);
  });

  it("joins multi-line question and answer text", () => {
    const cards = parse(
      `As per the definition
of "multiline" the prompt
can be on multiple lines
?
same goes for
the answer`
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("basic");
    expect(cards[0].q).toBe(
      'As per the definition of "multiline" the prompt can be on multiple lines'
    );
    expect(cards[0].a).toBe("same goes for the answer");
    expect(cards[0].isShorthand).toBe(true);
  });

  it("terminates at blank line after answer", () => {
    const cards = parse(
      `question text
?
answer text

some other prose`
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].q).toBe("question text");
    expect(cards[0].a).toBe("answer text");
  });

  it("does not match ? inside pipe-delimited cards", () => {
    const cards = parse("Q | question |\nA | answer |");
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("basic");
    expect(cards[0].isShorthand).toBe(false);
  });

  it("does not match ?? inside fenced code blocks", () => {
    const cards = parse(
      `\`\`\`
question
??
answer
\`\`\``
    );
    expect(cards).toHaveLength(0);
  });
});

// ── SR migration: cloze (==text==) ─────────────────────────────────────────

describe("SR cloze migration (==text==)", () => {
  it("converts simplified cloze with sequential numbering", () => {
    const cards = parse(
      "The first female ==prime minister== of Australia was ==Julia Gillard=="
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("cloze");
    expect(cards[0].clozeText).toBe(
      "The first female {{c1::prime minister}} of Australia was {{c2::Julia Gillard}}"
    );
    expect(cards[0].isShorthand).toBe(true);
  });

  it("converts cloze with hints using ^[hint] notation", () => {
    const cards = parse(
      "This ==note== doesn't need to have ==number==^[hint] on clozes"
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("cloze");
    expect(cards[0].clozeText).toBe(
      "This {{c1::note}} doesn't need to have {{c2::number::hint}} on clozes"
    );
    expect(cards[0].isShorthand).toBe(true);
  });

  it("converts classic cloze with [^N] grouping", () => {
    const cards = parse(
      "This is a ==cloze==^[a hint][^1]. This is ==too, but without hint==[^2]. And this one is asked ==together with the first cloze==[^1]."
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("cloze");
    expect(cards[0].clozeText).toBe(
      "This is a {{c1::cloze::a hint}}. This is {{c2::too, but without hint}}. And this one is asked {{c1::together with the first cloze}}."
    );
    expect(cards[0].isShorthand).toBe(true);
  });

  it("handles cloze with [^N] but no hint", () => {
    const cards = parse("First ==cloze==[^1]. Second ==cloze==[^2].");
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("cloze");
    expect(cards[0].clozeText).toBe(
      "First {{c1::cloze}}. Second {{c2::cloze}}."
    );
  });

  it("ignores lines without cloze deletions", () => {
    const cards = parse("Just a regular line of text.");
    expect(cards).toHaveLength(0);
  });

  it("does not interfere with existing CQ cards", () => {
    const cards = parse("CQ | existing {{c1::card}} |");
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("cloze");
    expect(cards[0].isShorthand).toBe(false);
    expect(cards[0].clozeText).toBe("existing {{c1::card}}");
  });

  it("does not match == inside fenced code blocks", () => {
    const cards = parse(
      `\`\`\`
The answer is ==42==
\`\`\``
    );
    expect(cards).toHaveLength(0);
  });

  it("converts mixed SR cloze and existing shorthand in same note", () => {
    const cards = parse(
      `The capital of {{France}} is ==Paris==
Basic Q::Basic A`
    );
    expect(cards).toHaveLength(2);
    expect(cards[0].type).toBe("cloze");
    expect(cards[0].clozeText).toBe(
      "The capital of {{c2::France}} is {{c1::Paris}}"
    );
    expect(cards[1].type).toBe("basic");
    expect(cards[1].q).toBe("Basic Q");
    expect(cards[1].a).toBe("Basic A");
  });
});
