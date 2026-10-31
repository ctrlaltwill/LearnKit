// @vitest-environment jsdom

/**
 * Plumbing tests for the vault sync reconcile path (#223, discussion #174).
 *
 * The full validity check needs a real sql.js instance, which this environment
 * mocks out, so the validator is injected here. What matters at this level is
 * that an unreadable copy never reaches the local file, and that adoption only
 * happens for a strictly newer copy.
 */

import { describe, expect, it } from "vitest";
import { reconcileFromVaultSync } from "../src/platform/core/sqlite-store";
import type { SyncedDbValidation } from "../src/platform/core/sqlite-sync-guard";
import type LearnKitPlugin from "../src/main";

const LOCAL = ".obsidian/plugins/learnkit/scheduling/flashcards.db";
const VAULT = "LearnKit/flashcards.db";

type Entry = { bytes: Uint8Array; mtime: number };

function makePlugin(entries: Record<string, Entry>) {
  const writes: Array<{ path: string; bytes: Uint8Array }> = [];

  const adapter = {
    exists: async (path: string) => path in entries,
    stat: async (path: string) => (path in entries ? { mtime: entries[path].mtime } : null),
    readBinary: async (path: string) => entries[path].bytes.slice().buffer,
    writeBinary: async (path: string, data: ArrayBuffer) => {
      writes.push({ path, bytes: new Uint8Array(data) });
      entries[path] = { bytes: new Uint8Array(data), mtime: Date.now() };
    },
  };

  const plugin = {
    settings: { storage: { vaultSync: { enabled: true, folderPath: "LearnKit/" } } },
    app: { vault: { adapter, configDir: ".obsidian" } },
    manifest: { id: "learnkit" },
  } as unknown as LearnKitPlugin;

  return { plugin, writes, entries };
}

function bytes(marker: number): Uint8Array {
  const out = new Uint8Array(2048);
  out[0] = marker;
  return out;
}

const ok: SyncedDbValidation = { ok: true, meta: { updatedAt: 5000, payloadLength: 100 } };
const invalid: SyncedDbValidation = { ok: false, reason: "not-sqlite" };

describe("reconcileFromVaultSync", () => {
  it("adopts a valid, strictly newer synced copy", async () => {
    const { plugin, writes, entries } = makePlugin({
      [LOCAL]: { bytes: bytes(1), mtime: 1000 },
      [VAULT]: { bytes: bytes(9), mtime: 2000 },
    });

    const adopted = await reconcileFromVaultSync(plugin, "flashcards.db", LOCAL, async () => ok);

    expect(adopted).toBe(true);
    expect(writes.map((w) => w.path)).toEqual([LOCAL]);
    expect(entries[LOCAL].bytes[0]).toBe(9);
  });

  it("refuses an unreadable copy and leaves the local database untouched", async () => {
    const { plugin, writes, entries } = makePlugin({
      [LOCAL]: { bytes: bytes(1), mtime: 1000 },
      [VAULT]: { bytes: bytes(9), mtime: 9999 },
    });

    const adopted = await reconcileFromVaultSync(plugin, "flashcards.db", LOCAL, async () => invalid);

    expect(adopted).toBe(false);
    expect(writes).toEqual([]);
    expect(entries[LOCAL].bytes[0]).toBe(1);
  });

  it("ignores a copy that is not newer", async () => {
    const { plugin, writes } = makePlugin({
      [LOCAL]: { bytes: bytes(1), mtime: 5000 },
      [VAULT]: { bytes: bytes(9), mtime: 1000 },
    });

    const adopted = await reconcileFromVaultSync(plugin, "flashcards.db", LOCAL, async () => ok);

    expect(adopted).toBe(false);
    expect(writes).toEqual([]);
  });

  it("adopts onto a device with no local database", async () => {
    const { plugin, writes } = makePlugin({
      [VAULT]: { bytes: bytes(9), mtime: 2000 },
    });

    const adopted = await reconcileFromVaultSync(plugin, "flashcards.db", LOCAL, async () => ok);

    expect(adopted).toBe(true);
    expect(writes.map((w) => w.path)).toEqual([LOCAL]);
  });

  it("does nothing when the sync folder has no copy", async () => {
    const { plugin, writes } = makePlugin({ [LOCAL]: { bytes: bytes(1), mtime: 1000 } });

    const adopted = await reconcileFromVaultSync(plugin, "flashcards.db", LOCAL, async () => ok);

    expect(adopted).toBe(false);
    expect(writes).toEqual([]);
  });

  it("does nothing when vault sync is disabled", async () => {
    const { plugin, writes } = makePlugin({
      [LOCAL]: { bytes: bytes(1), mtime: 1000 },
      [VAULT]: { bytes: bytes(9), mtime: 2000 },
    });
    plugin.settings.storage.vaultSync.enabled = false;

    const adopted = await reconcileFromVaultSync(plugin, "flashcards.db", LOCAL, async () => ok);

    expect(adopted).toBe(false);
    expect(writes).toEqual([]);
  });
});
