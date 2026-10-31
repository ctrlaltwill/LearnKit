// @vitest-environment jsdom

/**
 * Tests for the vault sync guard (#223, discussion #174).
 *
 * The vault sync folder is a whole-file copy, and Obsidian Sync cannot merge a
 * binary. Before this guard the vault copy replaced the local database whenever
 * its mtime was at least as new, with no check that the bytes were a database at
 * all. That turned "progress did not sync" into "progress is gone".
 *
 * `decideSyncAction` is pure so the rules can be pinned exactly. The SQLite-level
 * checks are covered by header and name tests here; the full integrity path needs
 * a real sql.js instance, which the test environment mocks out.
 */

import { describe, expect, it } from "vitest";
import {
  decideSyncAction,
  hasSqliteHeader,
  isConflictCopyName,
} from "../src/platform/core/sqlite-sync-guard";

function header(first16: string): Uint8Array {
  const bytes = new Uint8Array(2048);
  for (let i = 0; i < first16.length; i += 1) bytes[i] = first16.charCodeAt(i);
  return bytes;
}

describe("hasSqliteHeader", () => {
  it("accepts a real SQLite header", () => {
    expect(hasSqliteHeader(header("SQLite format 3"))).toBe(true);
  });

  it("rejects other content", () => {
    expect(hasSqliteHeader(header("SQLite format 2"))).toBe(false);
    expect(hasSqliteHeader(header("not a database!!"))).toBe(false);
  });

  it("rejects empty, short and missing input", () => {
    expect(hasSqliteHeader(new Uint8Array(0))).toBe(false);
    expect(hasSqliteHeader(new Uint8Array(4))).toBe(false);
    expect(hasSqliteHeader(null)).toBe(false);
    expect(hasSqliteHeader(undefined)).toBe(false);
  });
});

describe("isConflictCopyName", () => {
  it("recognises Obsidian's conflicted copies", () => {
    expect(isConflictCopyName("flashcards (conflicted copy 2026-06-30).db")).toBe(true);
    expect(isConflictCopyName("flashcards (conflicted copy dodette-XPS).db")).toBe(true);
  });

  it("recognises generic conflict names", () => {
    expect(isConflictCopyName("flashcards.conflict-2026-06-30.db")).toBe(true);
    expect(isConflictCopyName("flashcards.conflict.db")).toBe(true);
  });

  it("ignores the real database and unrelated files", () => {
    expect(isConflictCopyName("flashcards.db")).toBe(false);
    expect(isConflictCopyName("notes.db")).toBe(false);
    expect(isConflictCopyName("flashcards.md")).toBe(false);
    expect(isConflictCopyName("conflicted copy.txt")).toBe(false);
  });
});

describe("decideSyncAction", () => {
  const base = {
    vaultExists: true,
    localExists: true,
    vaultValid: true,
    vaultUpdatedAt: 2000,
    localUpdatedAt: 1000,
    vaultMtime: 2000,
    localMtime: 1000,
  };

  it("adopts when the synced snapshot is strictly newer", () => {
    expect(decideSyncAction(base)).toBe("adopt");
  });

  it("never adopts an unreadable file, however new it looks", () => {
    // This is the data-loss case: a merge result is not a database.
    expect(decideSyncAction({ ...base, vaultValid: false })).toBe("skip-invalid");
    expect(decideSyncAction({
      ...base,
      vaultValid: false,
      vaultUpdatedAt: 9999,
      vaultMtime: 9999,
    })).toBe("skip-invalid");
  });

  it("keeps the local copy when timestamps tie", () => {
    // The old `>=` comparison let the vault copy win every tie, which is how two
    // devices kept overwriting each other.
    expect(decideSyncAction({ ...base, vaultUpdatedAt: 1000, localUpdatedAt: 1000 })).toBe("skip");
  });

  it("keeps the local copy when the synced snapshot is older", () => {
    expect(decideSyncAction({ ...base, vaultUpdatedAt: 500, localUpdatedAt: 1000 })).toBe("skip");
  });

  it("falls back to mtime when a snapshot timestamp is missing", () => {
    expect(decideSyncAction({
      ...base,
      vaultUpdatedAt: null,
      localUpdatedAt: 1000,
      vaultMtime: 3000,
      localMtime: 1000,
    })).toBe("adopt");

    expect(decideSyncAction({
      ...base,
      vaultUpdatedAt: null,
      localUpdatedAt: null,
      vaultMtime: 1000,
      localMtime: 1000,
    })).toBe("skip");
  });

  it("adopts a synced database onto a device with none", () => {
    // First run on a new device: there is nothing local to lose.
    expect(decideSyncAction({ ...base, localExists: false, localUpdatedAt: null })).toBe("adopt");
  });

  it("does nothing when the sync folder has no copy", () => {
    expect(decideSyncAction({ ...base, vaultExists: false })).toBe("skip");
  });

  it("prefers the logical timestamp over a misleading file mtime", () => {
    // A sync client sets the mtime to "now" even for older content, so mtime
    // alone would adopt stale progress.
    expect(decideSyncAction({
      ...base,
      vaultUpdatedAt: 500,
      localUpdatedAt: 1000,
      vaultMtime: 99999,
      localMtime: 1,
    })).toBe("skip");
  });
});
