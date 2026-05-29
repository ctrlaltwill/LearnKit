/**
 * @file tests/settings-normalisation-cards.test.ts
 * @summary Unit tests for cards-related settings normalization behavior.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/platform/core/default-settings";
import { normaliseSettingsInPlace } from "../src/views/settings/config/settings-normalisation";

describe("cards settings normalization", () => {
  it("hydrates missing cards settings with defaults", () => {
    const settings = structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS & { cards?: typeof DEFAULT_SETTINGS.cards };
    delete settings.cards;

    normaliseSettingsInPlace(settings as typeof DEFAULT_SETTINGS);

    expect(settings.cards).toBeDefined();
    expect(settings.cards.selectionPrefillTarget).toBe("question");
  });

  it("normalizes invalid prefill targets to default", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.cards.selectionPrefillTarget = "bogus" as "question";

    normaliseSettingsInPlace(settings);

    expect(settings.cards.selectionPrefillTarget).toBe("question");
  });
});
