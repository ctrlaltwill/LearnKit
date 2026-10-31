/**
 * @file src/views/coach/coach-targets.ts
 * @summary Works out how much work a study plan should ask for per day.
 *
 *   The target used to be computed from the cards that happened to be due on the
 *   day the plan was created:
 *
 *     ceil(((dueCards + newCards) / daysLeft) * intensity)
 *
 *   On any real deck most cards are scheduled days or weeks ahead, so the "due
 *   today" set is small and the target collapsed to 1. The plan then showed
 *   "1 flashcard remaining", reported 100% of the daily target after a single
 *   card, and ignored the intensity setting: with 2 due cards and a 30 day plan,
 *   even the aggressive multiplier does not reach 2 (#225).
 *
 *   A daily target should describe the pace needed to get through the plan, so it
 *   is derived from the size of the plan's scope instead.
 *
 * @exports
 *   - computeDailyTargets — cards and notes to aim for per day
 */

export type DailyTargets = { cards: number; notes: number };

export type DailyTargetInput = {
  /** Cards in the plan's scope, whether due today or not. */
  totalCards: number;
  /** Notes in the plan's scope, whether due today or not. */
  totalNotes: number;
  /** Days left before the exam. Clamped to at least 1. */
  daysLeft: number;
  /** Intensity multiplier: relaxed 0.9, steady 1, aggressive 1.15. */
  multiplier: number;
};

function perDay(total: number, daysLeft: number, multiplier: number): number {
  const totalSafe = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  if (totalSafe === 0) return 0;

  const days = Number.isFinite(daysLeft) ? Math.max(1, Math.floor(daysLeft)) : 1;
  const mul = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1;

  const raw = Math.ceil((totalSafe / days) * mul);
  // Always some progress when there is work to do, and never more than the work.
  return Math.max(1, Math.min(totalSafe, raw));
}

/** Daily targets for a plan, derived from how much there is and how long is left. */
export function computeDailyTargets(input: DailyTargetInput): DailyTargets {
  return {
    cards: perDay(input.totalCards, input.daysLeft, input.multiplier),
    notes: perDay(input.totalNotes, input.daysLeft, input.multiplier),
  };
}
