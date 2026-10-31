// @vitest-environment jsdom

/**
 * Tests for the vault sync folder helpers behind #223.
 *
 * The sync folder is user-chosen, so it can be nested (`System/LearnKit`).
 * Obsidian's `adapter.mkdir` creates one directory and throws when the parent is
 * missing, which used to make a nested folder fail silently: the caller catches
 * everything as best-effort, so the user just saw an empty folder.
 */

import { describe, expect, it } from "vitest";
import { ensureDir } from "../src/platform/core/sqlite-store";

/** Mimics Obsidian's adapter: mkdir needs the parent to exist. */
function makeAdapter(existing: string[] = []) {
  const dirs = new Set(existing);
  const calls: string[] = [];

  const parentOf = (path: string): string => path.split("/").slice(0, -1).join("/");

  return {
    dirs,
    calls,
    exists: async (path: string) => dirs.has(path),
    mkdir: async (path: string) => {
      const parent = parentOf(path);
      if (parent && !dirs.has(parent)) {
        throw new Error(`ENOENT: parent of ${path} does not exist`);
      }
      if (dirs.has(path)) throw new Error(`EEXIST: ${path}`);
      dirs.add(path);
      calls.push(path);
    },
  };
}

describe("ensureDir", () => {
  it("creates a single folder", async () => {
    const adapter = makeAdapter();
    await ensureDir(adapter, "LearnKit");
    expect(adapter.dirs.has("LearnKit")).toBe(true);
  });

  it("creates every missing parent of a nested folder", async () => {
    const adapter = makeAdapter();
    await ensureDir(adapter, "System/LearnKit");
    expect(adapter.dirs.has("System")).toBe(true);
    expect(adapter.dirs.has("System/LearnKit")).toBe(true);
    expect(adapter.calls).toEqual(["System", "System/LearnKit"]);
  });

  it("creates three levels deep", async () => {
    const adapter = makeAdapter();
    await ensureDir(adapter, "System/Data/LearnKit");
    expect([...adapter.calls]).toEqual(["System", "System/Data", "System/Data/LearnKit"]);
  });

  it("does not re-create folders that already exist", async () => {
    const adapter = makeAdapter(["System"]);
    await ensureDir(adapter, "System/LearnKit");
    expect(adapter.calls).toEqual(["System/LearnKit"]);
  });

  it("is a no-op when the whole path already exists", async () => {
    const adapter = makeAdapter(["System", "System/LearnKit"]);
    await ensureDir(adapter, "System/LearnKit");
    expect(adapter.calls).toEqual([]);
  });

  it("tolerates a trailing slash", async () => {
    const adapter = makeAdapter();
    await ensureDir(adapter, "LearnKit/");
    expect(adapter.dirs.has("LearnKit")).toBe(true);
    expect(adapter.dirs.has("LearnKit/")).toBe(false);
  });

  it("tolerates a leading slash", async () => {
    const adapter = makeAdapter();
    await ensureDir(adapter, "/LearnKit");
    expect(adapter.dirs.has("LearnKit")).toBe(true);
  });

  it("does nothing for an empty path", async () => {
    const adapter = makeAdapter();
    await ensureDir(adapter, "");
    await ensureDir(adapter, "/");
    expect(adapter.calls).toEqual([]);
  });

  it("is a no-op on an adapter without mkdir", async () => {
    await expect(ensureDir({ exists: async () => false }, "LearnKit")).resolves.toBeUndefined();
  });
});
