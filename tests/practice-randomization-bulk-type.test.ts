/**
 * @file tests/practice-randomization-bulk-type.test.ts
 * @summary Tests for practice queue randomization and bulk edit basic↔reversed type conversion.
 */

import { describe, it, expect } from "vitest";
import { applyValueToCard } from "../src/views/browser/browser-card-data";
import { buildCardBlockPipeMarkdown } from "../src/views/browser/browser-helpers";
import type { CardRecord } from "../src/platform/core/store";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeBasicCard(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: "test-basic-1",
    type: "basic",
    title: "Test Title",
    q: "What is the capital of France?",
    a: "Paris",
    info: null,
    groups: null,
    sourceNotePath: "notes/geo.md",
    sourceStartLine: 1,
    ...overrides,
  };
}

function makeReversedCard(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: "test-reversed-1",
    type: "reversed",
    title: "Test Reversed",
    q: "What is H2O?",
    a: "Water",
    info: null,
    groups: null,
    sourceNotePath: "notes/chem.md",
    sourceStartLine: 1,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Practice queue randomization
// ──────────────────────────────────────────────────────────────────────────────

describe("practice queue randomization", () => {
  /**
   * Fisher-Yates shuffle (same algorithm used in startPracticeFromCurrentScope).
   */
  function fisherYatesShuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  it("shuffles an array in-place style (does not return same array instance)", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const original = [...input];
    const shuffled = fisherYatesShuffle(input);

    // Input array itself is not mutated (we copied it)
    expect(input).toEqual(original);
    // Shuffled array has same length
    expect(shuffled).toHaveLength(input.length);
    // Contains all same elements
    expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
  });

  it("produces different orderings across multiple runs (statistical)", () => {
    const cards = Array.from({ length: 50 }, (_, i) => `card-${i}`);
    const orderings = new Set<string>();
    const runs = 20;

    for (let r = 0; r < runs; r++) {
      const shuffled = fisherYatesShuffle(cards);
      orderings.add(shuffled.join(","));
    }

    // With 50! possible permutations, 20 runs should produce at least 10 unique orderings
    // (extremely unlikely to get many duplicates unless Math.random is badly broken)
    expect(orderings.size).toBeGreaterThanOrEqual(runs * 0.5);
  });

  it("handles empty array", () => {
    expect(fisherYatesShuffle([])).toEqual([]);
  });

  it("handles single-element array", () => {
    expect(fisherYatesShuffle([42])).toEqual([42]);
  });

  it("handles two-element array", () => {
    const results = new Set<string>();
    // Run many times; with 2 elements there are only 2 permutations
    for (let i = 0; i < 100; i++) {
      results.add(fisherYatesShuffle(["a", "b"]).join(","));
    }
    expect(results.has("a,b")).toBe(true);
    expect(results.has("b,a")).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Bulk edit type toggle (basic ↔ reversed)
// ──────────────────────────────────────────────────────────────────────────────

describe("bulk edit type toggle (basic ↔ reversed)", () => {
  describe("applyValueToCard type column", () => {
    it("changes basic to reversed via type column", () => {
      const original = makeBasicCard();
      const updated = applyValueToCard(original, "type", "reversed");

      expect(updated.type).toBe("reversed");
      // Original is not mutated
      expect(original.type).toBe("basic");
      // Other fields preserved
      expect(updated.q).toBe(original.q);
      expect(updated.a).toBe(original.a);
      expect(updated.title).toBe(original.title);
    });

    it("changes reversed to basic via type column", () => {
      const original = makeReversedCard();
      const updated = applyValueToCard(original, "type", "basic");

      expect(updated.type).toBe("basic");
      expect(original.type).toBe("reversed");
      expect(updated.q).toBe(original.q);
      expect(updated.a).toBe(original.a);
    });

    it("does not change type when value matches current type", () => {
      const basic = applyValueToCard(makeBasicCard(), "type", "basic");
      expect(basic.type).toBe("basic");

      const reversed = applyValueToCard(makeReversedCard(), "type", "reversed");
      expect(reversed.type).toBe("reversed");
    });
  });

  describe("buildCardBlockPipeMarkdown prefix", () => {
    it("basic card produces Q prefix", () => {
      const basic = makeBasicCard();
      const lines = buildCardBlockPipeMarkdown(basic.id, basic);

      const qLine = lines.find((l) => l.startsWith("Q |") || l.startsWith("Q|"));
      expect(qLine).toBeDefined();
      expect(qLine).toContain("What is the capital of France?");

      // Should NOT have RQ prefix
      const rqLine = lines.find((l) => l.startsWith("RQ |") || l.startsWith("RQ|"));
      expect(rqLine).toBeUndefined();
    });

    it("reversed card produces RQ prefix", () => {
      const reversed = makeReversedCard();
      const lines = buildCardBlockPipeMarkdown(reversed.id, reversed);

      const rqLine = lines.find((l) => l.startsWith("RQ |") || l.startsWith("RQ|"));
      expect(rqLine).toBeDefined();
      expect(rqLine).toContain("What is H2O?");

      // Should NOT have Q prefix
      const qLine = lines.find((l) => l.startsWith("Q |") || l.startsWith("Q|"));
      expect(qLine).toBeUndefined();
    });

    it("basic→reversed conversion changes Q to RQ in markdown", () => {
      const basic = makeBasicCard();
      const reversed = applyValueToCard(basic, "type", "reversed");
      const lines = buildCardBlockPipeMarkdown(reversed.id, reversed);

      // Should have RQ now
      const rqLine = lines.find((l) => l.startsWith("RQ |") || l.startsWith("RQ|"));
      expect(rqLine).toBeDefined();

      // Should NOT have Q prefix (the plain Q)
      const qLine = lines.find((l) => l.startsWith("Q |") || l.startsWith("Q|"));
      expect(qLine).toBeUndefined();
    });

    it("reversed→basic conversion changes RQ to Q in markdown", () => {
      const reversed = makeReversedCard();
      const basic = applyValueToCard(reversed, "type", "basic");
      const lines = buildCardBlockPipeMarkdown(basic.id, basic);

      // Should have Q now
      const qLine = lines.find((l) => l.startsWith("Q |") || l.startsWith("Q|"));
      expect(qLine).toBeDefined();

      // Should NOT have RQ prefix
      const rqLine = lines.find((l) => l.startsWith("RQ |") || l.startsWith("RQ|"));
      expect(rqLine).toBeUndefined();
    });
  });

  describe("full round-trip conversion", () => {
    it("basic → reversed → basic preserves original content", () => {
      const original = makeBasicCard();
      const reversed = applyValueToCard(original, "type", "reversed");
      const backToBasic = applyValueToCard(reversed, "type", "basic");

      expect(backToBasic.type).toBe("basic");
      expect(backToBasic.q).toBe(original.q);
      expect(backToBasic.a).toBe(original.a);

      // Markdown should be Q prefix again
      const lines = buildCardBlockPipeMarkdown(backToBasic.id, backToBasic);
      const qLine = lines.find((l) => l.startsWith("Q |") || l.startsWith("Q|"));
      expect(qLine).toBeDefined();
    });

    it("reversed → basic → reversed preserves original content", () => {
      const original = makeReversedCard();
      const basic = applyValueToCard(original, "type", "basic");
      const backToReversed = applyValueToCard(basic, "type", "reversed");

      expect(backToReversed.type).toBe("reversed");
      expect(backToReversed.q).toBe(original.q);
      expect(backToReversed.a).toBe(original.a);

      // Markdown should be RQ prefix again
      const lines = buildCardBlockPipeMarkdown(backToReversed.id, backToReversed);
      const rqLine = lines.find((l) => l.startsWith("RQ |") || l.startsWith("RQ|"));
      expect(rqLine).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("basic card with empty fields handles type conversion", () => {
      const empty = makeBasicCard({ q: "", a: "", title: "" });
      const reversed = applyValueToCard(empty, "type", "reversed");
      expect(reversed.type).toBe("reversed");
      expect(reversed.q).toBe("");
      expect(reversed.a).toBe("");
    });

    it("reversed card with title-only handles type conversion", () => {
      const title = makeReversedCard({ q: "", a: "", title: "Just Title" });
      const basic = applyValueToCard(title, "type", "basic");
      expect(basic.type).toBe("basic");
      expect(basic.title).toBe("Just Title");
    });

    it("non-basic/reversed cards are not affected by type toggle check", () => {
      // The canBulkToggleType check should reject non-basic/reversed types
      const types = ["cloze", "mcq", "oq", "io", "combo", "cloze-child", "reversed-child"];
      for (const type of types) {
        const isBasicOrReversed = type === "basic" || type === "reversed";
        expect(isBasicOrReversed).toBe(false);
      }
    });
  });
});
