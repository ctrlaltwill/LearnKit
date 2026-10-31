/**
 * @file src/reviewer/session.ts
 * @summary Core session-building logic for the reviewer. Resolves which cards are in scope (vault, folder, note, or group), applies daily new/review limits, filters for currently-available cards, shuffles and interleaves cloze/IO children with round-robin scheduling, and assembles the study queue.
 *
 * @exports
 *   - inScope — Predicate that checks whether a note path falls within a given scope
 *   - isAvailableNow — Determines if a card's state makes it eligible for study right now
 *   - buildSession — Constructs a full Session object (queue, stats, graded map) for a given scope
 *   - getNextDueInScope — Returns the earliest future due timestamp among cards in the given scope, or null
 *   - disperseSiblings — Spreads sibling child cards evenly across the queue (disperse mode)
 *   - collapseSiblingFamilies — Collapses each sibling family to a single active child (bury mode)
 */

import type LearnKitPlugin from "../../main";
import type { Scope, Session } from "./types";
import type { CardRecord } from "../../platform/core/store";
import type { ReviewLogEntry } from "../../platform/types/review";
import type { CardState } from "../../platform/types/scheduler";
import { selectCardsForScopes } from "../shared/scope-selection";

export type SessionBuildOptions = {
  ignoreDailyReviewLimit?: boolean;
  ignoreDailyNewLimit?: boolean;
  dueOnly?: boolean;
  /** Upper bound on the queue length (the Coach's remaining-target count). */
  targetCount?: number;
  trackCoachProgress?: boolean;
  practiceMode?: boolean;
  /**
   * Also study cards that are scheduled for later.
   *
   * Used by the Coach, which asks for a fixed number of cards per day and must
   * not come back empty just because everything left in the plan is scheduled
   * for tomorrow. Suspended and buried cards stay excluded.
   */
  includeNotDue?: boolean;
  /** Study the union of these scopes. `scope` is used for display. */
  scopes?: Scope[];
};

/**
 * Note-path predicate for the scopes that can be decided from a path alone.
 *
 * Kept for callers that have no `App` to hand (tag/property scopes need one).
 * Card selection goes through `selectCardsForScopes` in
 * `views/shared/scope-selection.ts` so that every surface applies the same rules.
 */
export function inScope(scope: Scope | null, notePath: string) {
  if (!scope) return true;
  if (scope.type === "vault") return true;

  if (scope.type === "folder") {
    const folder = notePath.includes("/")
      ? notePath.split("/").slice(0, -1).join("/")
      : "";
    return folder === scope.key || folder.startsWith(scope.key + "/");
  }

  if (scope.type === "note") return notePath === scope.key;

  // group scope is resolved by resolveCardsInScope(); path-based match N/A
  if (scope.type === "group") return false;

  // Unknown scope type — fail closed
  return false;
}

function startOfTodayMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function toNonNegIntOrInfinity(x: unknown): number {
  const n = Number(x);
  if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(n));
}

// Parent-card exclusion (parents are not reviewable) lives in the shared
// selector so every surface agrees on which cards can be studied.

/**
 * Returns how many NEW cards and REVIEW cards have already been *studied today* in this scope.
 *
 * Definitions:
 * - "New studied today" = cards whose first-ever review log entry is today (per scope).
 * - "Review studied today" = cards reviewed today whose first-ever review log entry is before today.
 *
 * Counts are per-card (distinct IDs), not per-review-event.
 */
function getTodayCountsInScope(
  plugin: LearnKitPlugin,
  idsInScope: Set<string>,
  startToday: number,
) {
  const log: ReviewLogEntry[] = plugin.store?.data?.reviewLog || [];

  const earliestAtById = new Map<string, number>();
  const reviewedToday = new Set<string>();

  for (const e of log) {
    const id = String(e?.id ?? "");
    if (!id) continue;
    if (!idsInScope.has(id)) continue;

    const at = Number(e?.at);
    if (!Number.isFinite(at)) continue;

    // Track earliest-ever review timestamp for this id
    const prevEarliest = earliestAtById.get(id);
    if (prevEarliest === undefined || at < prevEarliest) earliestAtById.set(id, at);

    // Track if reviewed today
    if (at >= startToday) reviewedToday.add(id);
  }

  let newDoneToday = 0;
  let reviewDoneToday = 0;

  for (const id of reviewedToday) {
    const firstAt = earliestAtById.get(id);
    if (firstAt === undefined) continue;

    if (firstAt >= startToday) newDoneToday += 1;
    else reviewDoneToday += 1;
  }

  return { newDoneToday, reviewDoneToday };
}

/**
 * Cards eligible for the active study queue.
 *
 * Intended behaviour:
 * - include "due" learning/relearning/review cards (due <= now)
 * - include "new" cards (common after a reset)
 * - exclude "suspended" cards
 * - be robust to missing/invalid due timestamps (treat as available so users don't get "No cards left")
 */
export function isAvailableNow(st: CardState | undefined, now: number): boolean {
  if (!st) return false;

  if (st.stage === "suspended") return false;

  // Buried cards are excluded until the bury expires
  if (typeof st.buriedUntil === "number" && Number.isFinite(st.buriedUntil) && st.buriedUntil > now) {
    return false;
  }

  if (st.stage === "new") return true;

  if (st.stage === "learning" || st.stage === "relearning" || st.stage === "review") {
    if (typeof st.due !== "number" || !Number.isFinite(st.due)) return true;
    return st.due <= now;
  }

  return false;
}

/**
 * Eligibility for the queue. Differs from {@link isAvailableNow} only when the
 * caller explicitly asked to include cards that are not due yet.
 */
function isSelectableNow(st: CardState | undefined, now: number, includeNotDue: boolean): boolean {
  if (!includeNotDue) return isAvailableNow(st, now);

  // Nothing known about the card: treat it as new rather than dropping it.
  // `buildSession` skipped these outright, so a card record without a state row
  // (partial restore, interrupted first sync) was invisible to the reviewer
  // while the Coach counted it as new.
  if (!st) return true;

  if (st.stage === "suspended") return false;

  if (typeof st.buriedUntil === "number" && Number.isFinite(st.buriedUntil) && st.buriedUntil > now) {
    return false;
  }

  return true;
}

function resolveCardsInScope(plugin: LearnKitPlugin, scopes: readonly Scope[]): CardRecord[] {
  return selectCardsForScopes(plugin, scopes);
}

export function buildSession(plugin: LearnKitPlugin, scope: Scope, options?: SessionBuildOptions): Session {
  const now = Date.now();
  const startToday = startOfTodayMs(now);

  const settings = plugin.settings;
  const study = settings?.study ?? {};

  const dailyNewLimit = options?.ignoreDailyNewLimit
    ? Number.POSITIVE_INFINITY
    : toNonNegIntOrInfinity(study.dailyNewLimit);
  const dailyReviewLimit = options?.ignoreDailyReviewLimit
    ? Number.POSITIVE_INFINITY
    : toNonNegIntOrInfinity(study.dailyReviewLimit);
  const dueOnly = options?.dueOnly === true;
  const includeNotDue = options?.includeNotDue === true;
  const siblingMode: string = (study as Record<string, unknown>).siblingMode as string ?? "standard";

  const scopes = options?.scopes?.length ? options.scopes : [scope];
  const cards = resolveCardsInScope(plugin, scopes);
  const states = plugin.store.data.states || {};

  // Scope IDs for today-count accounting
  const idsInScope = new Set<string>(cards.map((c) => String(c.id)));

  // How many have we already done today in this scope?
  const { newDoneToday, reviewDoneToday } = getTodayCountsInScope(plugin, idsInScope, startToday);

  const remainingNew =
    dailyNewLimit === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : Math.max(0, dailyNewLimit - newDoneToday);

  const remainingReview =
    dailyReviewLimit === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : Math.max(0, dailyReviewLimit - reviewDoneToday);

  // Filter to selectable cards (always respects suspended + buriedUntil)
  const available = cards.filter((c) => isSelectableNow(states[c.id], now, includeNotDue));

  // Partition into due-like, new, and (only when asked) scheduled-ahead
  const dueLike: CardRecord[] = [];
  const news: CardRecord[] = [];
  const scheduledAhead: CardRecord[] = [];

  for (const c of available) {
    const st = states[c.id];

    if (!st || st.stage === "new") {
      news.push(c);
    } else if (st.stage === "learning" || st.stage === "relearning" || st.stage === "review") {
      const dueAt = typeof st.due === "number" && Number.isFinite(st.due) ? st.due : null;
      if (includeNotDue && dueAt !== null && dueAt > now) scheduledAhead.push(c);
      else dueLike.push(c);
    } else {
      // Unknown stage: treat as available (but put at end)
      dueLike.push(c);
    }
  }

  // Sort due-like by due (invalid due sorts first)
  dueLike.sort((a, b) => {
    const sa = states[a.id];
    const sb = states[b.id];
    const da = sa && typeof sa.due === "number" && Number.isFinite(sa.due) ? Number(sa.due) : -1;
    const db = sb && typeof sb.due === "number" && Number.isFinite(sb.due) ? Number(sb.due) : -1;
    return da - db;
  });

  // Sort new by id (stable)
  news.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // Sort the not-yet-due tail by due, so the soonest-scheduled come first
  scheduledAhead.sort((a, b) => {
    const da = Number(states[a.id]?.due);
    const db = Number(states[b.id]?.due);
    return (Number.isFinite(da) ? da : 0) - (Number.isFinite(db) ? db : 0);
  });

  // Apply daily limits
  const dueTake =
    remainingReview === Number.POSITIVE_INFINITY ? dueLike : dueLike.slice(0, remainingReview);

  const newTake = dueOnly
    ? []
    : (remainingNew === Number.POSITIVE_INFINITY ? news : news.slice(0, remainingNew));

  // Cards outside today's limits only join the queue when the caller asked for
  // them explicitly (the Coach's daily target), and never in due-only mode.
  const aheadTake = dueOnly || !includeNotDue ? [] : scheduledAhead;

  // ── Combine and apply sibling mode ─────────────────────────────────────
  let queue: CardRecord[];

  if (siblingMode === "disperse") {
    queue = disperseSiblings([...dueTake, ...newTake, ...aheadTake]);
  } else if (siblingMode === "bury") {
    queue = collapseSiblingFamilies(cards, [...dueTake, ...newTake, ...aheadTake], states, now);
  } else {
    // "standard"
    queue = [...dueTake, ...newTake, ...aheadTake];
  }

  // The Coach asks for a fixed number of cards per day, so cap the queue after
  // interleaving. Only honoured when a caller passes a target; the deck browser,
  // widget and commands never do.
  const targetCount = Number.isFinite(Number(options?.targetCount))
    ? Math.max(0, Math.floor(Number(options?.targetCount)))
    : null;
  if (targetCount !== null && queue.length > targetCount) {
    queue = queue.slice(0, targetCount);
  }

  return {
    scope,
    scopes,
    queue,
    index: 0,
    graded: {},
    stats: { total: queue.length, done: 0 },
  };
}

// ── Sibling helpers ───────────────────────────────────────────────────────────

/** Returns true for child card types that have siblings. */
function isChildCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  return t === "cloze-child" || t === "io-child" || t === "hq-child" || t === "reversed-child" || t === "combo-child";
}

/** Resolves the parent key for a child card. */
function getParentKey(card: CardRecord): string {
  if (card.parentId) return card.parentId;
  const id = String(card.id || "");
  const clozeMatch = id.match(/^(.*)::cloze::/);
  if (clozeMatch) return clozeMatch[1];
  const ioMatch = id.match(/^(.*)::io::/);
  if (ioMatch) return ioMatch[1];
  const hqMatch = id.match(/^(.*)::hq::/);
  if (hqMatch) return hqMatch[1];
  const reversedMatch = id.match(/^(.*)::reversed::/);
  if (reversedMatch) return reversedMatch[1];
  if (card.groupKey) return card.groupKey;
  return id;
}

function isTemporarilyBuried(st: CardState | undefined, now: number): boolean {
  return !!(
    st &&
    typeof st.buriedUntil === "number" &&
    Number.isFinite(st.buriedUntil) &&
    st.buriedUntil > now
  );
}

function isSiblingStillActive(st: CardState | undefined, now: number): boolean {
  if (!st) return false;
  if (st.stage === "suspended") return false;
  void now;

  if (st.stage === "new") {
    return true;
  }

  return false;
}

function compareSiblingPriority(a: CardRecord, b: CardRecord, states: Record<string, CardState>): number {
  const sa = states[a.id];
  const sb = states[b.id];

  const rank = (st: CardState | undefined): number => {
    if (!st) return 3;
    if (st.stage === "learning" || st.stage === "relearning" || st.stage === "review") return 0;
    if (st.stage === "new") return 1;
    return 2;
  };

  const rankDiff = rank(sa) - rank(sb);
  if (rankDiff !== 0) return rankDiff;

  const dueValue = (st: CardState | undefined): number => {
    if (!st) return Number.POSITIVE_INFINITY;
    if (st.stage === "new") return Number.POSITIVE_INFINITY;
    if (typeof st.due === "number" && Number.isFinite(st.due)) return st.due;
    return Number.NEGATIVE_INFINITY;
  };

  const dueDiff = dueValue(sa) - dueValue(sb);
  if (dueDiff !== 0) return dueDiff;

  return String(a.id).localeCompare(String(b.id));
}

/**
 * Bury mode collapses each sibling family to a single active child until the
 * current child is no longer new, then the next sibling can appear.
 */
export function collapseSiblingFamilies(
  cardsInScope: CardRecord[],
  queueCards: CardRecord[],
  states: Record<string, CardState>,
  now: number,
): CardRecord[] {
  const blockedParents = new Set<string>();

  for (const c of cardsInScope) {
    if (!isChildCard(c)) continue;

    const st = states[c.id];
    if (!st) continue;
    if (st.stage === "suspended") continue;
    if (isTemporarilyBuried(st, now)) continue;
    if (isAvailableNow(st, now)) continue;
    if (!isSiblingStillActive(st, now)) continue;

    blockedParents.add(getParentKey(c));
  }

  const groups = new Map<string, CardRecord[]>();
  for (const c of queueCards) {
    if (!isChildCard(c)) continue;
    const key = getParentKey(c);
    if (blockedParents.has(key)) continue;
    const existing = groups.get(key);
    if (existing) existing.push(c);
    else groups.set(key, [c]);
  }

  const keepIds = new Set<string>();
  for (const siblings of groups.values()) {
    siblings.sort((a, b) => compareSiblingPriority(a, b, states));
    keepIds.add(String(siblings[0].id));
  }

  return queueCards.filter((c) => !isChildCard(c) || keepIds.has(String(c.id)));
}

/**
 * Disperse mode: spreads sibling child cards evenly across the queue.
 *
 * 1. Separate children from non-children.
 * 2. Group children by parent and round-robin across parent groups to produce
 *    an interleaved sequence where same-parent siblings are maximally spaced.
 * 3. Insert children at evenly-spaced positions among the non-child cards.
 */
export function disperseSiblings(cards: CardRecord[]): CardRecord[] {
  const children: CardRecord[] = [];
  const others: CardRecord[] = [];

  for (const c of cards) {
    if (isChildCard(c)) children.push(c);
    else others.push(c);
  }

  if (children.length === 0) return cards;

  // Group by parent
  const groups: Record<string, CardRecord[]> = {};
  for (const c of children) {
    const key = getParentKey(c);
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }

  // Round-robin across parents so siblings from the same parent are maximally apart
  const parentKeys = Object.keys(groups);
  const interleaved: CardRecord[] = [];
  let added: boolean;
  do {
    added = false;
    for (const key of parentKeys) {
      if (groups[key].length > 0) {
        interleaved.push(groups[key].shift()!);
        added = true;
      }
    }
  } while (added);

  // Insert interleaved children at evenly-spaced positions among others
  if (others.length === 0) return interleaved;

  const result: CardRecord[] = [];
  const totalSlots = others.length + interleaved.length;
  // Evenly distribute: place each child at position i * (total / childCount)
  const step = totalSlots / interleaved.length;
  const childPositions = new Set<number>();
  for (let i = 0; i < interleaved.length; i++) {
    childPositions.add(Math.round(i * step));
  }

  let ci = 0;
  let oi = 0;
  for (let pos = 0; pos < totalSlots; pos++) {
    if (childPositions.has(pos) && ci < interleaved.length) {
      result.push(interleaved[ci++]);
    } else if (oi < others.length) {
      result.push(others[oi++]);
    } else if (ci < interleaved.length) {
      result.push(interleaved[ci++]);
    }
  }

  return result;
}

export function getNextDueInScope(plugin: LearnKitPlugin, scope: Scope): number | null {
  return getNextDueInScopes(plugin, [scope]);
}

export function getNextDueInScopes(plugin: LearnKitPlugin, scopes: readonly Scope[]): number | null {
  const now = Date.now();
  const cards = resolveCardsInScope(plugin, scopes);

  const states = plugin.store.data.states || {};
  let next: number | null = null;

  for (const c of cards) {
    const st = states[c.id];
    if (!st) continue;
    if (st.stage === "suspended") continue;

    if (
      (st.stage === "learning" || st.stage === "relearning" || st.stage === "review") &&
      typeof st.due === "number" &&
      Number.isFinite(st.due) &&
      st.due > now
    ) {
      if (next === null || st.due < next) next = st.due;
    }
  }

  return next;
}
