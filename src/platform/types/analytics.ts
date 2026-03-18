/**
 * @file src/types/analytics.ts
 * @summary Analytics event type definitions. Structures recorded when a user reviews cards
 * or completes a study session, consumed by charts, heatmaps, and KPI displays. Includes
 * per-card review events, session-level events, a discriminated union of all event types,
 * and the top-level AnalyticsData storage shape.
 *
 * @exports
 *   - AnalyticsMode — type for scheduled vs practice review mode
 *   - AnalyticsReviewEvent — type for a single card-review analytics event
 *   - AnalyticsSessionEvent — type for a study-session analytics event
 *   - AnalyticsExamAttemptEvent — type for a saved exam/test attempt
 *   - AnalyticsNoteReviewEvent — type for a note-review grading/action event
 *   - AnalyticsEvent — discriminated union of all analytics event types
 *   - AnalyticsData — top-level analytics storage structure (version, seq, events)
 */

import type { ReviewResult } from "./review";
import type { Scope } from "../../views/reviewer/types";

/** Whether a review happened in scheduled mode or free-practice mode. */
export type AnalyticsMode = "scheduled" | "practice";

/**
 * Recorded when a single card is graded.
 * Contains the outcome, timing, and optional scope for filtering.
 */
export type AnalyticsReviewEvent = {
  kind: "review";
  eventId: string;

  /** Timestamp of the review. */
  at: number;

  cardId: string;
  cardType: string;

  result: ReviewResult;
  mode: AnalyticsMode;

  /** Approximate time-to-answer in ms (for heatmaps / KPIs). */
  msToAnswer?: number;

  /** Only for scheduled grading — mirrors the reviewLog entry. */
  prevDue?: number;
  nextDue?: number;

  /** Optional scope captured at review time (deck/note) for later filtering. */
  scope?: Scope;

  /** Freeform metadata (MCQ choice details, pass/fail etc.). */
  meta?: Record<string, unknown>;
};

/**
 * Recorded when a study session starts or ends.
 * Used for session-level analytics (duration, frequency).
 */
export type AnalyticsSessionEvent = {
  kind: "session";
  eventId: string;
  at: number;
  scope?: Scope;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
};

/**
 * Recorded when an exam/test attempt is submitted.
 * Used for test-performance analytics views.
 */
export type AnalyticsExamAttemptEvent = {
  kind: "exam-attempt";
  eventId: string;
  at: number;

  testId: string;
  attemptId?: string;
  label?: string;
  sourceSummary?: string;

  finalPercent: number;
  autoSubmitted?: boolean;
  elapsedSec?: number;

  mcqCount?: number;
  saqCount?: number;
};

/**
 * Recorded when a note is acted on in Note Review.
 * Includes both scheduled and practice mode actions.
 */
export type AnalyticsNoteReviewEvent = {
  kind: "note-review";
  eventId: string;
  at: number;

  noteId: string;
  sourceNotePath: string;
  mode: AnalyticsMode;

  action: "pass" | "fail" | "read" | "bury" | "suspend" | "skip";

  algorithm?: "fsrs" | "lkrs";
};

/** Discriminated union of all analytics event types. */
export type AnalyticsEvent =
  | AnalyticsReviewEvent
  | AnalyticsSessionEvent
  | AnalyticsExamAttemptEvent
  | AnalyticsNoteReviewEvent;

/**
 * Top-level analytics storage structure.
 * `seq` is a monotonically-increasing ID seed for new events.
 */
export type AnalyticsData = {
  version: number;
  seq: number;
  events: AnalyticsEvent[];
};
