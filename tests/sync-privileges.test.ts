/**
 * @file tests/sync-privileges.test.ts
 * @summary Unit tests for sync privilege prompt version helpers.
 */

import { describe, expect, it } from "vitest";
import {
  CURRENT_SYNC_PRIVILEGES_CHOICE_VERSION,
  normaliseSyncPrivilegesChoiceVersion,
  requiresSyncPrivilegesChoice,
} from "../src/platform/integrations/sync/sync-privileges";

describe("sync privilege version helpers", () => {
  it("normalises invalid values to 0", () => {
    expect(normaliseSyncPrivilegesChoiceVersion(undefined)).toBe(0);
    expect(normaliseSyncPrivilegesChoiceVersion(null)).toBe(0);
    expect(normaliseSyncPrivilegesChoiceVersion("oops")).toBe(0);
    expect(normaliseSyncPrivilegesChoiceVersion(-3)).toBe(0);
  });

  it("floors valid positive values", () => {
    expect(normaliseSyncPrivilegesChoiceVersion(1)).toBe(1);
    expect(normaliseSyncPrivilegesChoiceVersion(2.8)).toBe(2);
  });

  it("requires prompt when stored version is behind current", () => {
    expect(requiresSyncPrivilegesChoice(0)).toBe(true);
    expect(requiresSyncPrivilegesChoice(CURRENT_SYNC_PRIVILEGES_CHOICE_VERSION)).toBe(false);
    expect(requiresSyncPrivilegesChoice(CURRENT_SYNC_PRIVILEGES_CHOICE_VERSION + 1)).toBe(false);
  });
});
