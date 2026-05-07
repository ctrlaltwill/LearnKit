import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FOLLOW_OBSIDIAN_INTERFACE_LOCALE,
  getSupportedInterfaceLocales,
  resolveInterfaceLocale,
  resolveInterfaceLocalePreference,
} from "../src/platform/translations/locale-registry";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("locale registry", () => {
  it("includes Follow Obsidian option", () => {
    const locales = getSupportedInterfaceLocales();
    const follow = locales.find((l) => l.code === FOLLOW_OBSIDIAN_INTERFACE_LOCALE);
    expect(!!follow).toBe(true);
    expect(follow?.label).toContain("Obsidian");
    expect(follow?.flagCode).toBe("checkered");
  });

  it("preserves obsidian preference token", () => {
    expect(resolveInterfaceLocalePreference("obsidian")).toBe(FOLLOW_OBSIDIAN_INTERFACE_LOCALE);
    expect(resolveInterfaceLocalePreference("auto")).toBe(FOLLOW_OBSIDIAN_INTERFACE_LOCALE);
  });

  it("resolves follow-obsidian using Obsidian locale when supported", () => {
    vi.stubGlobal("app", {
      vault: {
        getConfig: (key: string) => (key === "locale" ? "zh-cn" : ""),
      },
    });

    expect(resolveInterfaceLocale(FOLLOW_OBSIDIAN_INTERFACE_LOCALE)).toBe("zh-cn");
  });

  it("falls back to en-us when Obsidian locale is unsupported", () => {
    vi.stubGlobal("app", {
      vault: {
        getConfig: (key: string) => (key === "locale" ? "fr-fr" : ""),
      },
    });

    expect(resolveInterfaceLocale(FOLLOW_OBSIDIAN_INTERFACE_LOCALE)).toBe("en-us");
  });
});
