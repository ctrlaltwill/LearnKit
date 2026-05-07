/**
 * @file src/platform/core/grade-intervals.ts
 * @summary Module for grade intervals.
 *
 * @exports
 *  - formatCompactInterval
 *  - getRatingIntervalPreview
 */

import { gradeFromRating } from "../../engine/scheduler/scheduler";
import type { SchedulerSettings, CardState, ReviewRating } from "../types/scheduler";

const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

function formatDaysWithHalfStep(days: number): string {
  const roundedHalf = Math.max(0.5, Math.round(days * 2) / 2);
  const asText = Number.isInteger(roundedHalf) ? String(roundedHalf) : roundedHalf.toFixed(1);
  return `${asText}d`;
}

function isZhLocale(locale: unknown): boolean {
  const code = (typeof locale === 'string' ? locale : '').trim().toLowerCase();
  return code.startsWith("zh");
}

function formatDaysWithHalfStepZh(days: number): string {
  const roundedHalf = Math.max(0.5, Math.round(days * 2) / 2);
  const asText = Number.isInteger(roundedHalf) ? String(roundedHalf) : roundedHalf.toFixed(1);
  return `${asText}天`;
}

/**
 * Formats a review interval using compact units similar to Anki's grade hints.
 */
export function formatCompactInterval(ms: number, locale?: string): string {
  const zh = isZhLocale(locale);
  if (!Number.isFinite(ms) || ms <= 0) return zh ? "<1分" : "<1m";

  if (ms < MS_HOUR) {
    const minutes = Math.max(1, Math.round(ms / MS_MINUTE));
    return zh ? `${minutes}分` : `${minutes}m`;
  }

  if (ms < MS_DAY) {
    const hours = Math.max(1, Math.round(ms / MS_HOUR));
    return zh ? `${hours}时` : `${hours}h`;
  }

  const days = ms / MS_DAY;
  if (days < 10) return zh ? formatDaysWithHalfStepZh(days) : formatDaysWithHalfStep(days);
  if (days < 365) return zh ? `${Math.max(1, Math.round(days))}天` : `${Math.max(1, Math.round(days))}d`;

  const years = Math.max(1, Math.round(days / 365));
  return zh ? `${years}年` : `${years}y`;
}

export function getRatingIntervalPreview(args: {
  state: CardState;
  rating: ReviewRating;
  now: number;
  scheduling: SchedulerSettings;
  locale?: string;
}): string | null {
  try {
    const graded = gradeFromRating(args.state, args.rating, args.now, {
      scheduling: args.scheduling,
    });
    return formatCompactInterval(graded.nextDue - args.now, args.locale);
  } catch {
    return null;
  }
}
