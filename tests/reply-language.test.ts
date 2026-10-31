// @vitest-environment jsdom

/**
 * Regression tests for issue #218 — "AI reply language forced to English when
 * 'Match Obsidian' is selected".
 *
 * The instruction sent to the model is built from the *resolved* locale. With
 * the default "obsidian" preference the old code emitted
 * `Use English (obsidian) …`, so every AI feature answered in English no matter
 * what Obsidian's interface language was.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOLLOW_OBSIDIAN_INTERFACE_LOCALE,
  getSupportedInterfaceLocales,
  resolveInterfaceLocale,
} from "../src/platform/translations/locale-registry";
import {
  assistantReplyLanguageName,
  buildReplyLanguageInstruction,
} from "../src/views/study-assistant/popup/reply-language";

/** Stubs Obsidian's persisted interface locale the way the host exposes it. */
function stubObsidianLocale(raw: string): void {
  vi.stubGlobal("app", {
    vault: { getConfig: (key: string) => (key === "locale" ? raw : "") },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reply language instruction (#218)", () => {
  it("follows Obsidian's locale when the preference is Match Obsidian", () => {
    stubObsidianLocale("zh-cn");

    const code = resolveInterfaceLocale(FOLLOW_OBSIDIAN_INTERFACE_LOCALE);
    const instruction = buildReplyLanguageInstruction(code);

    expect(code).toBe("zh-cn");
    expect(instruction).toContain("Simplified Chinese");
    expect(instruction).toContain("(zh-cn)");
    // The defect: the raw preference token leaking into the prompt.
    expect(instruction).not.toContain("obsidian");
    expect(instruction).not.toContain("English");
  });

  it("treats a missing or unknown preference as English, never as an empty code", () => {
    stubObsidianLocale("");

    for (const preference of ["obsidian", "auto", "follow-obsidian", undefined, null, ""]) {
      const code = resolveInterfaceLocale(preference);
      expect(code.length).toBeGreaterThan(0);
      expect(code).not.toBe("obsidian");
      expect(assistantReplyLanguageName(code)).toBe("English");
    }
  });

  it("keeps an explicit locale unchanged", () => {
    stubObsidianLocale("en-gb");
    const code = resolveInterfaceLocale("ja");
    expect(code).toBe("ja");
    expect(buildReplyLanguageInstruction(code)).toBe(
      "Use Japanese (ja) for your response unless the user explicitly requests a different language.",
    );
  });

  it("names every supported non-English locale", () => {
    // Pins the registry and the language-name table together: adding a locale
    // without a name here would silently send "English (<code>)" again.
    const unnamed = getSupportedInterfaceLocales()
      .map((locale) => locale.code)
      .filter((code) => code !== FOLLOW_OBSIDIAN_INTERFACE_LOCALE)
      .filter((code) => !code.startsWith("en"))
      .filter((code) => assistantReplyLanguageName(code) === "English");

    expect(unnamed).toEqual([]);
  });

  it("maps regional variants onto their primary language", () => {
    expect(assistantReplyLanguageName("zh-cn")).toBe("Simplified Chinese");
    expect(assistantReplyLanguageName("zh-tw")).toBe("Simplified Chinese");
    expect(assistantReplyLanguageName("en-gb")).toBe("English");
    expect(assistantReplyLanguageName("fr-CA")).toBe("French");
  });

  it("falls back to a usable code when handed nothing", () => {
    expect(buildReplyLanguageInstruction("")).toBe(
      "Use English (en) for your response unless the user explicitly requests a different language.",
    );
  });
});
