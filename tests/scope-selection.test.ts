// @vitest-environment jsdom

/**
 * Guard for the shared scope selector (#225).
 *
 * Four copies of "does this belong to the scope?" used to live in four files and
 * disagreed. Coach showed a plan's card counts from one copy and opened the
 * session with another, so a plan could report 30 cards and then say the deck
 * was empty. Everything now goes through `selectCardsForScopes`.
 *
 * The table below is deliberately explicit about the three places where the old
 * implementations disagreed, because those are the only behaviour changes:
 *
 *   1. a folder key with a trailing slash now matches (it used to match in the
 *      Coach counts and not in the reviewer);
 *   2. a group scope now includes descendant groups and ignores case (it used
 *      to be exact-match in the Coach counts and index-based in the reviewer);
 *   3. an empty folder key means the whole vault (it used to mean "root notes
 *      only" in the reviewer).
 */

import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import type LearnKitPlugin from "../src/main";
import type { CardRecord } from "../src/platform/core/store";
import type { Scope } from "../src/views/reviewer/types";
import {
  normaliseFolderScopeKey,
  noteMatchesAnyScope,
  noteMatchesScope,
  notePathsForScopes,
  selectCardsForScopes,
} from "../src/views/shared/scope-selection";

type CardSpec = {
  id: string;
  path: string;
  groups?: string[];
  parentId?: string;
  type?: string;
};

function makeFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split("/").pop() ?? path;
  file.extension = "md";
  return file;
}

function makePlugin(cards: CardSpec[], files: TFile[] = []): LearnKitPlugin {
  const records: Record<string, CardRecord> = {};
  for (const card of cards) {
    records[card.id] = {
      id: card.id,
      sourceNotePath: card.path,
      groups: card.groups ?? [],
      type: card.type ?? "basic",
      ...(card.parentId ? { parentId: card.parentId } : {}),
    } as unknown as CardRecord;
  }

  const fileMap = new Map(files.map((file) => [file.path, file]));

  return {
    store: {
      getAllCards: () => Object.values(records),
      getRevision: () => 1,
    },
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => fileMap.get(path) ?? null,
      },
      metadataCache: { getFileCache: () => null },
    },
  } as unknown as LearnKitPlugin;
}

function ids(cards: CardRecord[]): string[] {
  return cards.map((c) => String(c.id)).sort();
}

const CARDS: CardSpec[] = [
  { id: "bio-root", path: "Biology/cells.md" },
  { id: "bio-nested", path: "Biology/cell/mitosis.md" },
  { id: "chem", path: "Chemistry/atoms.md" },
  { id: "loose", path: "scratch.md" },
  { id: "group-own", path: "Topics/x.md", groups: ["Cardiology"] },
  { id: "group-child", path: "Topics/y.md", groups: ["Cardiology/ECG"] },
  { id: "group-other-case", path: "Topics/z.md", groups: ["cardiology"] },
  { id: "parent", path: "Biology/cells.md", type: "cloze" },
  { id: "parent-child", path: "Biology/cells.md", type: "cloze-child", parentId: "parent" },
];

describe("normaliseFolderScopeKey", () => {
  it("normalises separators, leading ./ and trailing slashes", () => {
    expect(normaliseFolderScopeKey("Biology")).toBe("Biology");
    expect(normaliseFolderScopeKey("Biology/")).toBe("Biology");
    expect(normaliseFolderScopeKey("Biology///")).toBe("Biology");
    expect(normaliseFolderScopeKey("./Biology")).toBe("Biology");
    expect(normaliseFolderScopeKey("Biology\\Cells")).toBe("Biology/Cells");
    expect(normaliseFolderScopeKey("")).toBe("");
    expect(normaliseFolderScopeKey(undefined)).toBe("");
  });
});

describe("noteMatchesScope", () => {
  const app = makePlugin([]).app;

  it("matches any note for a vault scope", () => {
    expect(noteMatchesScope(app, { type: "vault", key: "", name: "Vault" }, "deep/x.md")).toBe(true);
  });

  it("matches a folder and its descendants, with or without a trailing slash", () => {
    const plain: Scope = { type: "folder", key: "Biology", name: "Biology" };
    const slashed: Scope = { type: "folder", key: "Biology/", name: "Biology" };

    for (const scope of [plain, slashed]) {
      expect(noteMatchesScope(app, scope, "Biology/cells.md")).toBe(true);
      expect(noteMatchesScope(app, scope, "Biology/cell/mitosis.md")).toBe(true);
      expect(noteMatchesScope(app, scope, "Chemistry/atoms.md")).toBe(false);
      expect(noteMatchesScope(app, scope, "scratch.md")).toBe(false);
    }
  });

  it("treats an empty folder key as the vault root", () => {
    expect(noteMatchesScope(app, { type: "folder", key: "", name: "Root" }, "scratch.md")).toBe(true);
    expect(noteMatchesScope(app, { type: "folder", key: "", name: "Root" }, "deep/x.md")).toBe(true);
  });

  it("matches a single note exactly, ignoring path decoration", () => {
    const scope: Scope = { type: "note", key: "Biology/cells.md", name: "Cells" };
    expect(noteMatchesScope(app, scope, "Biology/cells.md")).toBe(true);
    expect(noteMatchesScope(app, scope, "./Biology/cells.md")).toBe(true);
    expect(noteMatchesScope(app, scope, "Biology/cells2.md")).toBe(false);
  });

  it("answers false for group scopes, which are card-level", () => {
    expect(noteMatchesScope(app, { type: "group", key: "Cardiology", name: "Cardiology" }, "x.md")).toBe(false);
  });

  it("fails closed for an unknown scope type", () => {
    expect(noteMatchesScope(app, { type: "whatever" as never, key: "", name: "" }, "x.md")).toBe(false);
  });

  it("treats a missing scope list as everything", () => {
    expect(noteMatchesAnyScope(app, null, "x.md")).toBe(true);
    expect(noteMatchesAnyScope(app, [], "x.md")).toBe(true);
  });
});

describe("selectCardsForScopes", () => {
  it("returns every reviewable card for a vault scope", () => {
    const plugin = makePlugin(CARDS);
    const got = ids(selectCardsForScopes(plugin, [{ type: "vault", key: "", name: "Vault" }]));
    // Parent cards are containers; their children are what gets reviewed.
    expect(got).not.toContain("parent");
    expect(got).toContain("parent-child");
    expect(got.length).toBe(CARDS.length - 1);
  });

  it("selects a folder's cards, trailing slash included", () => {
    const plugin = makePlugin(CARDS);
    for (const key of ["Biology", "Biology/"]) {
      expect(ids(selectCardsForScopes(plugin, [{ type: "folder", key, name: key }])))
        .toEqual(["bio-nested", "bio-root", "parent-child"]);
    }
  });

  it("selects a single note's cards", () => {
    const plugin = makePlugin(CARDS);
    expect(ids(selectCardsForScopes(plugin, [{ type: "note", key: "Chemistry/atoms.md", name: "Atoms" }])))
      .toEqual(["chem"]);
  });

  it("selects a group's cards, descendants included and case ignored", () => {
    const plugin = makePlugin(CARDS);
    // This is the correction that makes Coach's count match what Study opens.
    expect(ids(selectCardsForScopes(plugin, [{ type: "group", key: "Cardiology", name: "Cardiology" }])))
      .toEqual(["group-child", "group-other-case", "group-own"]);
  });

  it("supports the legacy comma-separated group key", () => {
    const plugin = makePlugin(CARDS);
    expect(ids(selectCardsForScopes(plugin, [{ type: "group", key: "Cardiology , Nothing", name: "Mixed" }])))
      .toEqual(["group-child", "group-other-case", "group-own"]);
  });

  it("unions several scopes without duplicating cards", () => {
    const plugin = makePlugin(CARDS);
    const got = ids(selectCardsForScopes(plugin, [
      { type: "note", key: "Chemistry/atoms.md", name: "Atoms" },
      { type: "group", key: "Cardiology", name: "Cardiology" },
      { type: "folder", key: "Biology", name: "Biology" },
    ]));
    expect(got).toEqual([
      "bio-nested",
      "bio-root",
      "chem",
      "group-child",
      "group-other-case",
      "group-own",
      "parent-child",
    ]);
  });

  it("lets a vault scope in a union pull in everything", () => {
    const plugin = makePlugin(CARDS);
    const got = ids(selectCardsForScopes(plugin, [
      { type: "note", key: "Chemistry/atoms.md", name: "Atoms" },
      { type: "vault", key: "", name: "Vault" },
    ]));
    expect(got.length).toBe(CARDS.length - 1);
  });

  it("returns nothing for a scope that matches no cards", () => {
    const plugin = makePlugin(CARDS);
    expect(selectCardsForScopes(plugin, [{ type: "folder", key: "Nope", name: "Nope" }])).toEqual([]);
    expect(selectCardsForScopes(plugin, [{ type: "group", key: "Unused", name: "Unused" }])).toEqual([]);
  });

  it("matches tag scopes through the note's metadata", () => {
    const files = [makeFile("Biology/cells.md"), makeFile("Chemistry/atoms.md")];
    const plugin = makePlugin(CARDS, files);
    const app = plugin.app as unknown as {
      metadataCache: { getFileCache: (f: TFile) => unknown };
    };
    app.metadataCache = {
      getFileCache: (file: TFile) => (file.path === "Biology/cells.md" ? { tags: [{ tag: "#examtopic" }] } : null),
    };

    expect(ids(selectCardsForScopes(plugin, [{ type: "tag", key: "examtopic", name: "#examtopic" }])))
      .toEqual(["bio-root", "parent-child"]);
  });
});

describe("notePathsForScopes", () => {
  it("collects the note paths reached by the union, including group members", () => {
    const plugin = makePlugin(CARDS);
    const got = Array.from(notePathsForScopes(plugin, [
      { type: "note", key: "Chemistry/atoms.md", name: "Atoms" },
      { type: "group", key: "Cardiology", name: "Cardiology" },
    ])).sort();

    expect(got).toEqual(["Chemistry/atoms.md", "Topics/x.md", "Topics/y.md", "Topics/z.md"]);
  });
});
