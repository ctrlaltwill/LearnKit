// @vitest-environment jsdom

/**
 * Tests for the study plan's daily target (#225).
 *
 * The old formula divided the cards that were due *on the day the plan was
 * created* by the days remaining. On a real deck almost everything is scheduled
 * ahead, so the result was 1: the plan showed "1 flashcard remaining", reported
 * 100% of target after a single card, and the intensity setting made no
 * difference. Reported by Feder0n after the first round of coach fixes.
 */

import { describe, expect, it } from "vitest";
import { computeDailyTargets } from "../src/views/coach/coach-targets";

const base = { totalCards: 300, totalNotes: 60, daysLeft: 30, multiplier: 1 };

describe("computeDailyTargets", () => {
  it("spreads the whole plan over the days available", () => {
    // 300 cards over 30 days is 10 a day, not "as many as happen to be due".
    expect(computeDailyTargets(base).cards).toBe(10);
    expect(computeDailyTargets(base).notes).toBe(2);
  });

  it("scales with intensity", () => {
    expect(computeDailyTargets({ ...base, multiplier: 0.9 }).cards).toBe(9);
    expect(computeDailyTargets({ ...base, multiplier: 1.15 }).cards).toBe(12);
  });

  it("never asks for more than the plan contains", () => {
    // A one-day plan with 5 cards cannot ask for more than 5.
    expect(computeDailyTargets({ totalCards: 5, totalNotes: 5, daysLeft: 1, multiplier: 1.15 }))
      .toEqual({ cards: 5, notes: 5 });
  });

  it("rounds up, so a plan always makes progress", () => {
    // 7 cards over 30 days is 0.23 a day, which must not round down to zero.
    expect(computeDailyTargets({ totalCards: 7, totalNotes: 7, daysLeft: 30, multiplier: 1 }).cards)
      .toBe(1);
  });

  it("asks for nothing when the plan covers nothing", () => {
    expect(computeDailyTargets({ totalCards: 0, totalNotes: 0, daysLeft: 30, multiplier: 1 }))
      .toEqual({ cards: 0, notes: 0 });
  });

  it("treats a same-day exam as one day left instead of dividing by zero", () => {
    expect(computeDailyTargets({ totalCards: 20, totalNotes: 20, daysLeft: 0, multiplier: 1 }).cards)
      .toBe(20);
    expect(computeDailyTargets({ totalCards: 20, totalNotes: 20, daysLeft: 0, multiplier: 1 }).notes)
      .toBe(20);
  });

  it("is unaffected by how many cards happen to be due today", () => {
    // There is no due count in the input at all: that is the fix. Two structurally
    // different decks of the same size get the same pace.
    const dueHeavy = computeDailyTargets({ totalCards: 300, totalNotes: 0, daysLeft: 30, multiplier: 1 });
    const dueEmpty = computeDailyTargets({ totalCards: 300, totalNotes: 0, daysLeft: 30, multiplier: 1 });
    expect(dueHeavy).toEqual(dueEmpty);
    expect(dueHeavy.cards).toBeGreaterThan(1);
  });

  it("handles nonsense input without producing a negative target", () => {
    expect(computeDailyTargets({
      totalCards: Number.NaN,
      totalNotes: -5,
      daysLeft: Number.NaN,
      multiplier: Number.NaN,
    })).toEqual({ cards: 0, notes: 0 });
  });
});
