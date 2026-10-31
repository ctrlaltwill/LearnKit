// @vitest-environment jsdom

/**
 * Regression tests for #225 — "Coach mode not seeing flashcards".
 *
 * Four separate defects produced the report:
 *   a. a plan with several selected topics only ever studied the first one;
 *   b. `includeNotDue` was accepted by the Coach and ignored by the session
 *      builder, so a plan whose cards were all scheduled for later opened empty;
 *   c. the empty state was forced to claim "No cards exist in this deck" for
 *      every Coach session, even when the real reason was "nothing due";
 *   d. the Coach's counts and the reviewer's selection used different rules
 *      (covered by `scope-selection.test.ts`).
 */

import { describe, expect, it } from "vitest";
import type LearnKitPlugin from "../src/main";
import type { CardRecord, CardState } from "../src/platform/core/store";
import type { Scope } from "../src/views/reviewer/types";
import { buildSession, getNextDueInScope, getNextDueInScopes } from "../src/views/reviewer/session";

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

type Spec = {
  id: string;
  path: string;
  state?: Partial<CardState> | "missing";
  groups?: string[];
  type?: string;
  parentId?: string;
};

function makePlugin(specs: Spec[]): LearnKitPlugin {
  const cards: Record<string, CardRecord> = {};
  const states: Record<string, CardState> = {};

  for (const spec of specs) {
    cards[spec.id] = {
      id: spec.id,
      sourceNotePath: spec.path,
      groups: spec.groups ?? [],
      type: spec.type ?? "basic",
      ...(spec.parentId ? { parentId: spec.parentId } : {}),
    } as unknown as CardRecord;

    if (spec.state === "missing") continue;
    states[spec.id] = {
      id: spec.id,
      stage: "review",
      due: NOW - DAY,
      reps: 1,
      lapses: 0,
      ...(spec.state ?? {}),
    } as unknown as CardState;
  }

  return {
    settings: {
      study: {},
    },
    store: {
      data: { cards, states },
      getAllCards: () => Object.values(cards),
      getRevision: () => 1,
      getState: (id: string) => states[id],
    },
    app: {
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getFileCache: () => null },
    },
  } as unknown as LearnKitPlugin;
}

const BIO: Scope = { type: "folder", key: "Biology", name: "Biology" };
const CHEM: Scope = { type: "folder", key: "Chemistry", name: "Chemistry" };

function ids(session: { queue: CardRecord[] }): string[] {
  return session.queue.map((c) => String(c.id)).sort();
}

describe("buildSession across several scopes (#225a)", () => {
  const plugin = makePlugin([
    { id: "bio-1", path: "Biology/cells.md" },
    { id: "bio-2", path: "Biology/dna.md" },
    { id: "chem-1", path: "Chemistry/atoms.md" },
    { id: "other", path: "Other/x.md" },
  ]);

  it("studies only the primary scope by default", () => {
    expect(ids(buildSession(plugin, BIO))).toEqual(["bio-1", "bio-2"]);
  });

  it("studies the union when scopes are supplied", () => {
    const session = buildSession(plugin, BIO, { scopes: [BIO, CHEM] });
    expect(ids(session)).toEqual(["bio-1", "bio-2", "chem-1"]);
    // Display scope stays the first one.
    expect(session.scope.type).toBe("folder");
    expect(session.scope.key).toBe("Biology");
    expect(session.scopes?.length).toBe(2);
  });

  it("does not duplicate a card that appears in two scopes", () => {
    const nested: Scope = { type: "folder", key: "Biology/cells.md", name: "x" };
    const session = buildSession(plugin, BIO, { scopes: [BIO, nested, BIO] });
    expect(ids(session)).toEqual(["bio-1", "bio-2"]);
  });

  it("reports the next due date across all scopes", () => {
    const future = NOW + 2 * DAY;
    const p = makePlugin([
      { id: "a", path: "Biology/a.md", state: { due: NOW + 5 * DAY } },
      { id: "b", path: "Chemistry/b.md", state: { due: future } },
    ]);
    expect(getNextDueInScope(p, BIO)).toBe(NOW + 5 * DAY);
    expect(getNextDueInScopes(p, [BIO, CHEM])).toBe(future);
  });
});

describe("includeNotDue (#225b)", () => {
  const plugin = makePlugin([
    { id: "due", path: "Biology/due.md", state: { due: NOW - DAY } },
    { id: "later", path: "Biology/later.md", state: { due: NOW + 3 * DAY } },
    { id: "fresh", path: "Biology/fresh.md", state: { stage: "new", due: NOW } },
  ]);

  it("excludes cards scheduled for later when the flag is absent", () => {
    // This is the behaviour that made a Coach session open empty.
    expect(ids(buildSession(plugin, BIO))).toEqual(["due", "fresh"]);
  });

  it("includes cards scheduled for later when asked", () => {
    expect(ids(buildSession(plugin, BIO, { includeNotDue: true }))).toEqual(["due", "fresh", "later"]);
  });

  it("puts due cards first, then new, then the not-yet-due tail", () => {
    const session = buildSession(plugin, BIO, { includeNotDue: true });
    expect(session.queue.map((c) => String(c.id))).toEqual(["due", "fresh", "later"]);
  });

  it("still excludes suspended and buried cards", () => {
    const p = makePlugin([
      { id: "suspended", path: "Biology/s.md", state: { stage: "suspended", due: NOW - DAY } },
      { id: "buried", path: "Biology/b.md", state: { due: NOW - DAY, buriedUntil: NOW + DAY } },
      { id: "ok", path: "Biology/o.md", state: { due: NOW + DAY } },
    ]);
    expect(ids(buildSession(p, BIO, { includeNotDue: true }))).toEqual(["ok"]);
  });

  it("treats a card with no state row as new rather than dropping it", () => {
    const p = makePlugin([
      { id: "stateless", path: "Biology/x.md", state: "missing" },
    ]);
    // Ignored by default, exactly as before...
    expect(ids(buildSession(p, BIO))).toEqual([]);
    // ...but a Coach session must not lose it, because the Coach counts it as new.
    expect(ids(buildSession(p, BIO, { includeNotDue: true }))).toEqual(["stateless"]);
  });

  it("never includes not-due cards in due-only mode", () => {
    expect(ids(buildSession(plugin, BIO, { includeNotDue: true, dueOnly: true }))).toEqual(["due"]);
  });
});

describe("targetCount (#225)", () => {
  const specs: Spec[] = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i}`,
    path: "Biology/x.md",
    state: { due: NOW - DAY },
  }));

  it("caps the queue when a target is supplied", () => {
    const session = buildSession(makePlugin(specs), BIO, { targetCount: 4 });
    expect(session.queue.length).toBe(4);
    expect(session.stats.total).toBe(4);
  });

  it("ignores a target larger than the scope", () => {
    const session = buildSession(makePlugin(specs), BIO, { targetCount: 99 });
    expect(session.queue.length).toBe(10);
  });

  it("leaves the queue uncapped when no target is supplied", () => {
    // Deck browser, widget and command paths must keep their old behaviour.
    expect(buildSession(makePlugin(specs), BIO).queue.length).toBe(10);
  });
});
