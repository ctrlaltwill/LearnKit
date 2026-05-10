/**
 * @file tests/reading-extract-card-source.test.ts
 * @summary Unit tests for reading extract card source.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, expect, it } from "vitest";
import { extractCardFromSource, parseLearnKitCard } from "../src/views/reading/reading-helpers";

describe("extractCardFromSource", () => {
  it("keeps multiline heading/list content inside a delimited field until closing delimiter", () => {
    const source = [
      "^sprout-501802774",
      "T | Hi |",
      "Q | # Heading 1",
      "## Heading 2",
      "### Heading 3",
      "#### Heading 4",
      "##### Heading 5",
      "###### Heading 6 |",
      "A | - List Item 1",
      "- List Item 2 |",
      "",
      "## Outside card heading",
    ].join("\n");

    const extracted = extractCardFromSource(source, "501802774");

    expect(extracted).toBe([
      "^sprout-501802774",
      "T | Hi |",
      "Q | # Heading 1",
      "## Heading 2",
      "### Heading 3",
      "#### Heading 4",
      "##### Heading 5",
      "###### Heading 6 |",
      "A | - List Item 1",
      "- List Item 2 |",
    ].join("\n"));
  });

  it("keeps trailing I field after multiline cloze list content", () => {
    const source = [
      "^learnkit-260783268",
      "T | Delta Ratio Interpretation for Metabolic Acidosis |",
      "CQ | Delta ratio = $( \\text{Anion Gap} - 12 ) / ( 24 - \\text{HCO}_3^- )$.",
      "- Value <0.4 indicates {{c1::NAGMA}}.",
      "- Over 2.0 indicates {{c1::HAGMA and concurrent metabolic alkalosis or respiratory acidosis}}. |",
      "I | Use only when a HAGMA is present (AG >12). |",
      "",
      "## Outside heading",
    ].join("\n");

    const extracted = extractCardFromSource(source, "260783268");

    expect(extracted).toBe([
      "^learnkit-260783268",
      "T | Delta Ratio Interpretation for Metabolic Acidosis |",
      "CQ | Delta ratio = $( \\text{Anion Gap} - 12 ) / ( 24 - \\text{HCO}_3^- )$.",
      "- Value <0.4 indicates {{c1::NAGMA}}.",
      "- Over 2.0 indicates {{c1::HAGMA and concurrent metabolic alkalosis or respiratory acidosis}}. |",
      "I | Use only when a HAGMA is present (AG >12). |",
    ].join("\n"));
  });
});

describe("parseLearnKitCard", () => {
  it("preserves nested list indentation inside multiline delimited fields", () => {
    const source = [
      "^sprout-501802774",
      "T | Hi |",
      "Q | # Heading 1",
      "## Heading 2",
      "- Bullet one",
      "\t- Bullet two |",
      "A |",
      "- List Item 1",
      "- List Item 2",
      "\t- Inline |",
    ].join("\n");

    const card = parseLearnKitCard(source);

    expect(card).not.toBeNull();
    expect(card?.fields.Q).toBe("# Heading 1\n## Heading 2\n- Bullet one\n\t- Bullet two");
    expect(card?.fields.A).toBe("- List Item 1\n- List Item 2\n\t- Inline");
  });

  it("parses cloze list blocks and trailing I fields from a single card", () => {
    const source = [
      "^learnkit-260783268",
      "T | Delta Ratio Interpretation for Metabolic Acidosis |",
      "CQ | Delta ratio = formula",
      "- Value <0.4 indicates {{c1::NAGMA}}.",
      "- Over 2.0 indicates {{c1::HAGMA and concurrent metabolic alkalosis or respiratory acidosis}}. |",
      "I | Use only when a HAGMA is present (AG >12). |",
    ].join("\n");

    const card = parseLearnKitCard(source);

    expect(card).not.toBeNull();
    expect(card?.fields.CQ).toBe(
      [
        "Delta ratio = formula",
        "- Value <0.4 indicates {{c1::NAGMA}}.",
        "- Over 2.0 indicates {{c1::HAGMA and concurrent metabolic alkalosis or respiratory acidosis}}.",
      ].join("\n"),
    );
    expect(card?.fields.I).toBe("Use only when a HAGMA is present (AG >12).");
  });

  // ── Shorthand card parsing ────────────────────────────────────────

  it("parses basic shorthand: Q::A", () => {
    const source = [
      "^learnkit-504222627",
      "What is the capital of France?::Paris",
    ].join("\n");

    const card = parseLearnKitCard(source);

    expect(card).not.toBeNull();
    expect(card?.type).toBe("basic");
    expect(card?.fields.Q).toBe("What is the capital of France?");
    expect(card?.fields.A).toBe("Paris");
  });

  it("parses reversed shorthand: Q:::A", () => {
    const source = [
      "^learnkit-487449431",
      "What is the capital of France?:::Paris",
    ].join("\n");

    const card = parseLearnKitCard(source);

    expect(card).not.toBeNull();
    expect(card?.type).toBe("reversed");
    expect(card?.fields.RQ).toBe("What is the capital of France?");
    expect(card?.fields.A).toBe("Paris");
  });

  it("parses cloze shorthand with cloze:: prefix", () => {
    const source = [
      "^learnkit-199886018",
      "cloze::The capital of {{c1::France}} is {{c2::Paris}}",
    ].join("\n");

    const card = parseLearnKitCard(source);

    expect(card).not.toBeNull();
    expect(card?.type).toBe("cloze");
    expect(card?.fields.CQ).toBe("The capital of {{c1::France}} is {{c2::Paris}}");
  });

  it("parses cloze shorthand with cq:: prefix (lowercase)", () => {
    const source = [
      "^learnkit-199886019",
      "cq::The capital of {{c1::France}} is {{c2::Paris}}",
    ].join("\n");

    const card = parseLearnKitCard(source);

    expect(card).not.toBeNull();
    expect(card?.type).toBe("cloze");
    expect(card?.fields.CQ).toBe("The capital of {{c1::France}} is {{c2::Paris}}");
  });

  it("parses cloze shorthand with CQ:: prefix (uppercase)", () => {
    const source = [
      "^learnkit-199886020",
      "CQ::The capital of {{c1::France}} is {{c2::Paris}}",
    ].join("\n");

    const card = parseLearnKitCard(source);

    expect(card).not.toBeNull();
    expect(card?.type).toBe("cloze");
    expect(card?.fields.CQ).toBe("The capital of {{c1::France}} is {{c2::Paris}}");
  });

  it("auto-numbers bare {{}} cloze tokens in shorthand", () => {
    const source = [
      "^learnkit-199886021",
      "cloze::The capital of {{France}} is {{Paris}}",
    ].join("\n");

    const card = parseLearnKitCard(source);

    expect(card).not.toBeNull();
    expect(card?.type).toBe("cloze");
    expect(card?.fields.CQ).toBe("The capital of {{c1::France}} is {{c2::Paris}}");
  });

  it("skips blank lines between anchor and shorthand", () => {
    const source = [
      "^learnkit-504222628",
      "",
      "What is the capital of France?::Paris",
    ].join("\n");

    const card = parseLearnKitCard(source);

    expect(card).not.toBeNull();
    expect(card?.type).toBe("basic");
    expect(card?.fields.Q).toBe("What is the capital of France?");
    expect(card?.fields.A).toBe("Paris");
  });

  it("falls through to pipe-delimited parsing when no shorthand matches", () => {
    const source = [
      "^sprout-501802774",
      "T | Hi |",
      "Q | What is 2+2? |",
      "A | 4 |",
    ].join("\n");

    const card = parseLearnKitCard(source);

    expect(card).not.toBeNull();
    expect(card?.type).toBe("basic");
    expect(card?.fields.Q).toBe("What is 2+2?");
    expect(card?.fields.A).toBe("4");
  });
});

describe("extractCardFromSource with shorthands", () => {
  it("extracts basic shorthand card from source", () => {
    const source = [
      "Some text before",
      "^learnkit-504222627",
      "What is the capital of France?::Paris",
      "Some text after",
    ].join("\n");

    const extracted = extractCardFromSource(source, "504222627");

    expect(extracted).toBe([
      "^learnkit-504222627",
      "What is the capital of France?::Paris",
    ].join("\n"));
  });

  it("extracts reversed shorthand card from source", () => {
    const source = [
      "^learnkit-487449431",
      "What is the capital of France?:::Paris",
      "^learnkit-999999999",
      "Next card",
    ].join("\n");

    const extracted = extractCardFromSource(source, "487449431");

    expect(extracted).toBe([
      "^learnkit-487449431",
      "What is the capital of France?:::Paris",
    ].join("\n"));
  });

  it("extracts cloze shorthand card from source", () => {
    const source = [
      "^learnkit-199886018",
      "cloze::The capital of {{c1::France}} is {{c2::Paris}}",
      "",
      "## Next Section",
    ].join("\n");

    const extracted = extractCardFromSource(source, "199886018");

    expect(extracted).toBe([
      "^learnkit-199886018",
      "cloze::The capital of {{c1::France}} is {{c2::Paris}}",
    ].join("\n"));
  });
});
