import { describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import type LearnKitPlugin from "../src/main";
import type { CoachPlanRow } from "../src/platform/core/coach-plan-sqlite";

vi.mock("../src/platform/integrations/anki/anki-sql", async () => {
  const SQL = await initSqlJs();
  return { getSqlJs: async () => SQL };
});
vi.mock("../src/platform/core/sqlite-store", () => ({
  getSchedulingDirPath: () => "scheduling",
  copyDbToVaultSyncFolder: async () => {},
  reconcileFromVaultSync: async () => {},
}));

const { CoachPlanSqlite } = await import("../src/platform/core/coach-plan-sqlite");

describe("edited study plan", () => {
  it("restores the new primary scope when a folder is replaced with a single note", async () => {
    const files = new Map<string, ArrayBuffer>();
    const adapter = {
      exists: async (path: string) => files.has(path),
      mkdir: async () => {},
      writeBinary: async (path: string, data: ArrayBuffer) => { files.set(path, data); },
      readBinary: async (path: string) => files.get(path),
    };
    const plugin = { app: { vault: { adapter } } } as unknown as LearnKitPlugin;
    const store = new CoachPlanSqlite(plugin);
    await store.open();
    const plan: CoachPlanRow = {
      plan_id: "exam", scope_type: "folder", scope_key: "History", scope_name: "History",
      scope_data: "", plan_name: "Midterm", exam_date_utc: 1, intensity: "balanced",
      daily_flashcard_target: 1, daily_note_target: 1, status: "on-track", updated_at: 1,
    };
    store.upsertPlan(plan);
    store.upsertPlan({ ...plan, scope_type: "note", scope_key: "Rome.md", scope_name: "Rome" });
    await store.close();

    const reopened = new CoachPlanSqlite(plugin);
    await reopened.open();
    expect(reopened.listPlans()).toMatchObject([
      { plan_id: "exam", scope_type: "note", scope_key: "Rome.md", scope_name: "Rome" },
    ]);
    reopened.discard();
  });
});
