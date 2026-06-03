/**
 * @file tests/settings-normalisation-sync-privileges.test.ts
 * @summary Unit tests for sync privilege normalization behavior.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/platform/core/default-settings";
import { normaliseSettingsInPlace } from "../src/views/settings/config/settings-normalisation";

describe("sync privilege normalization", () => {
  it("migrates legacy simple privilege to simple-compat", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.general.syncPrivileges = "simple";

    normaliseSettingsInPlace(settings);

    expect(settings.general.syncPrivileges).toBe("simple-compat");
  });

  it("preserves simple-safe privilege", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.general.syncPrivileges = "simple-safe";

    normaliseSettingsInPlace(settings);

    expect(settings.general.syncPrivileges).toBe("simple-safe");
  });

  it("falls back invalid privilege values to defaults", () => {
    const settings = structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS;
    settings.general.syncPrivileges = "bogus" as "off";

    normaliseSettingsInPlace(settings);

    expect(settings.general.syncPrivileges).toBe(DEFAULT_SETTINGS.general.syncPrivileges);
  });

  it("normalises missing sync privilege choice version to 0", () => {
    const settings = structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS;
    delete (settings.general as typeof settings.general & { syncPrivilegesChoiceVersion?: number }).syncPrivilegesChoiceVersion;

    normaliseSettingsInPlace(settings);

    expect(settings.general.syncPrivilegesChoiceVersion).toBe(0);
  });

  it("normalises invalid sync privilege choice version to 0", () => {
    const settings = structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS;
    settings.general.syncPrivilegesChoiceVersion = Number.NaN;

    normaliseSettingsInPlace(settings);

    expect(settings.general.syncPrivilegesChoiceVersion).toBe(0);
  });

  it("preserves positive sync privilege choice version", () => {
    const settings = structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS;
    settings.general.syncPrivilegesChoiceVersion = 3.9;

    normaliseSettingsInPlace(settings);

    expect(settings.general.syncPrivilegesChoiceVersion).toBe(3);
  });
});