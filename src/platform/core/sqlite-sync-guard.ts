/**
 * @file src/platform/core/sqlite-sync-guard.ts
 * @summary Decides whether a database delivered by Obsidian Sync may replace the
 *   local copy, and refuses anything that is not a readable LearnKit database.
 *
 *   Why this exists: the vault sync folder is a whole-file copy, and Obsidian
 *   Sync cannot merge a binary file. When two devices have both written, the
 *   "merge" it reports produces either a damaged database or a separate
 *   conflicted copy. The old code adopted the vault copy whenever its mtime was
 *   at least as new as the local one, checking only that the file was not empty,
 *   so a damaged file could replace good progress. Reported as "the other device
 *   does not recognise the database" (#223, discussion #174).
 *
 * @exports
 *   - hasSqliteHeader — cheap magic-number check
 *   - isConflictCopyName — recognises Obsidian's conflict copies
 *   - readSyncedDbMeta — logical timestamp of a database, if readable
 *   - validateSyncedDb — full validity check before adoption
 *   - decideSyncAction — pure decision, so the rules are testable
 */

import type { Database } from "sql.js";
import { getSqlJs } from "../integrations/anki/anki-sql";

/** Every SQLite database starts with these 16 bytes. */
const SQLITE_MAGIC = "SQLite format 3";

export type SyncedDbMeta = {
  /** `store_snapshot.updated_at` for the single snapshot row, in epoch ms. */
  updatedAt: number;
  /** Length of the serialised snapshot payload. */
  payloadLength: number;
};

/** True when the bytes begin with the SQLite magic number. */
export function hasSqliteHeader(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.byteLength < SQLITE_MAGIC.length) return false;
  let header = "";
  for (let i = 0; i < SQLITE_MAGIC.length; i += 1) {
    header += String.fromCharCode(bytes[i]);
  }
  return header === SQLITE_MAGIC;
}

/**
 * True for the extra files Obsidian Sync leaves behind when it cannot merge.
 * It names them like `flashcards (conflicted copy 2026-06-30).db`, and some
 * sync tools use `flashcards.conflict-...db`, so match loosely.
 */
export function isConflictCopyName(fileName: string): boolean {
  const name = String(fileName ?? "");
  if (!/\.db$/i.test(name)) return false;
  return /conflicted copy/i.test(name) || /\.conflict[-.]/i.test(name);
}

function closeQuietly(db: Database | null): void {
  if (!db) return;
  try {
    db.close();
  } catch {
    // Nothing useful to do; the handle is being discarded.
  }
}

/**
 * Reads the snapshot's logical timestamp from a database.
 *
 * Returns null when the bytes are not a database, the table is missing, or the
 * row cannot be read. This is the ordering signal for adoption: it is written on
 * every persist, so it survives file mtimes being reset by a sync client.
 */
export async function readSyncedDbMeta(bytes: Uint8Array | null | undefined): Promise<SyncedDbMeta | null> {
  if (!hasSqliteHeader(bytes)) return null;

  let db: Database | null = null;
  try {
    const SQL = await getSqlJs();
    db = new SQL.Database(bytes as Uint8Array);

    const stmt = db.prepare("SELECT updated_at, length(payload) AS payload_len FROM store_snapshot WHERE id = 1");
    try {
      if (!stmt.step()) return null;
      const row = stmt.getAsObject() as { updated_at?: unknown; payload_len?: unknown };
      const updatedAt = Number(row.updated_at);
      const payloadLength = Number(row.payload_len);
      if (!Number.isFinite(updatedAt) || !Number.isFinite(payloadLength)) return null;
      if (payloadLength <= 0) return null;
      return { updatedAt, payloadLength };
    } finally {
      stmt.free();
    }
  } catch {
    return null;
  } finally {
    closeQuietly(db);
  }
}

export type SyncedDbValidation =
  | { ok: true; meta: SyncedDbMeta }
  | { ok: false; reason: "empty" | "not-sqlite" | "unreadable" | "no-snapshot" | "corrupt" };

/**
 * Full check before a synced database is allowed to replace the local one.
 *
 * A file that fails here is left where it is and never copied over the local
 * database. That is the difference between "your progress did not sync" and
 * "your progress is gone".
 */
export async function validateSyncedDb(bytes: Uint8Array | null | undefined): Promise<SyncedDbValidation> {
  if (!bytes || bytes.byteLength === 0) return { ok: false, reason: "empty" };
  // A database with our snapshot cannot be smaller than a few pages.
  if (bytes.byteLength < 1024) return { ok: false, reason: "unreadable" };
  if (!hasSqliteHeader(bytes)) return { ok: false, reason: "not-sqlite" };

  const meta = await readSyncedDbMeta(bytes);
  if (!meta) return { ok: false, reason: "no-snapshot" };

  let db: Database | null = null;
  try {
    const SQL = await getSqlJs();
    db = new SQL.Database(bytes);

    const result = db.exec("PRAGMA integrity_check;");
    const value = result?.[0]?.values?.[0]?.[0];
    if (String(value ?? "").toLowerCase() !== "ok") {
      return { ok: false, reason: "corrupt" };
    }

    const probe = db.prepare("SELECT payload FROM store_snapshot WHERE id = 1");
    try {
      if (!probe.step()) return { ok: false, reason: "no-snapshot" };
      const row = probe.getAsObject() as { payload?: unknown };
      if (typeof row.payload !== "string") return { ok: false, reason: "no-snapshot" };
      JSON.parse(row.payload);
    } finally {
      probe.free();
    }

    return { ok: true, meta };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    closeQuietly(db);
  }
}

export type SyncDecision = "adopt" | "skip" | "skip-invalid";

/**
 * Whether the vault copy should replace the local copy.
 *
 * Ordering prefers the snapshot's own timestamp over the file mtime, because a
 * sync client can reset or preserve mtimes. The mtime is only a fallback for
 * databases written before that column existed. Ties keep the local copy: the
 * old `>=` comparison let the vault copy win every tie, which is how two devices
 * kept overwriting each other.
 */
export function decideSyncAction(input: {
  vaultExists: boolean;
  localExists: boolean;
  vaultValid: boolean;
  vaultUpdatedAt: number | null;
  localUpdatedAt: number | null;
  vaultMtime: number;
  localMtime: number;
}): SyncDecision {
  if (!input.vaultExists) return "skip";
  if (!input.vaultValid) return "skip-invalid";
  if (!input.localExists) return "adopt";

  const bothTimed = input.vaultUpdatedAt !== null && input.localUpdatedAt !== null;
  if (bothTimed) {
    return (input.vaultUpdatedAt as number) > (input.localUpdatedAt as number) ? "adopt" : "skip";
  }

  return input.vaultMtime > input.localMtime ? "adopt" : "skip";
}
