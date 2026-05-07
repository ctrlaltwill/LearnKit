/**
 * @file src/platform/translations/locale-registry.ts
 * @summary Module for locale registry.
 *
 * @exports
 *  - InterfaceLocaleDefinition
 *  - DEFAULT_INTERFACE_LOCALE
 *  - DEFAULT_INTERFACE_LOCALE_PREFERENCE
 *  - FOLLOW_OBSIDIAN_INTERFACE_LOCALE
 *  - getSupportedInterfaceLocales
 *  - normaliseInterfaceLocale
 *  - resolveInterfaceLocalePreference
 *  - resolveInterfaceLocale
 *  - interfaceLocaleToIntlLocale
 *  - getInterfaceLocaleLabel
 */

export type InterfaceLocaleDefinition = {
  code: string;
  label: string;
  nativeLabel: string;
  flagCode?: string;
  status: "stable" | "community";
};

export const DEFAULT_INTERFACE_LOCALE = "en-gb";
export const FOLLOW_OBSIDIAN_INTERFACE_LOCALE = "obsidian";
export const DEFAULT_INTERFACE_LOCALE_PREFERENCE = FOLLOW_OBSIDIAN_INTERFACE_LOCALE;
const OBSIDIAN_UNSUPPORTED_FALLBACK_LOCALE = "en-us";
const FOLLOW_LABEL = "Match Obsidian";

const INTERFACE_LOCALE_REGISTRY: ReadonlyArray<InterfaceLocaleDefinition> = [
  {
    code: FOLLOW_OBSIDIAN_INTERFACE_LOCALE,
    label: FOLLOW_LABEL,
    nativeLabel: "Match Obsidian",
    flagCode: "checkered",
    status: "stable",
  },
  {
    code: "en-gb",
    label: "English (UK)",
    nativeLabel: "English (United Kingdom)",
    flagCode: "en-gb",
    status: "stable",
  },
  {
    code: "en-us",
    label: "English (US)",
    nativeLabel: "English (United States)",
    flagCode: "en-us",
    status: "stable",
  },
  {
    code: "zh-cn",
    label: "Chinese (Simplified)",
    nativeLabel: "简体中文",
    flagCode: "cn",
    status: "community",
  },
];

const MANUAL_INTERFACE_LOCALE_SET = new Set(
  INTERFACE_LOCALE_REGISTRY
    .map((locale) => locale.code)
    .filter((code) => code !== FOLLOW_OBSIDIAN_INTERFACE_LOCALE),
);

export function getSupportedInterfaceLocales(): InterfaceLocaleDefinition[] {
  return INTERFACE_LOCALE_REGISTRY.map((locale) => ({ ...locale }));
}

export function normaliseInterfaceLocale(value: unknown): string {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return `${value}`.trim().toLowerCase();
  return "";
}

function toSupportedManualLocale(value: unknown, fallback: string): string {
  const candidate = normaliseInterfaceLocale(value).replace(/_/g, "-");

  if (candidate === "zh" || candidate.startsWith("zh-")) return "zh-cn";
  if (candidate === "en-gb" || candidate.startsWith("en-gb")) return "en-gb";
  if (candidate === "en-us" || candidate.startsWith("en-us")) return "en-us";
  if (candidate === "en") return DEFAULT_INTERFACE_LOCALE;

  return MANUAL_INTERFACE_LOCALE_SET.has(candidate) ? candidate : fallback;
}

function readObsidianLocalePreference(): string {
  const root = globalThis as unknown as {
    app?: { vault?: { getConfig?: (key: string) => unknown }; i18n?: { locale?: unknown } };
    window?: { app?: { vault?: { getConfig?: (key: string) => unknown }; i18n?: { locale?: unknown } } };
  };

  const app = root.app ?? root.window?.app;
  const fromConfig = app?.vault?.getConfig?.("locale");
  const fromI18n = app?.i18n?.locale;
  const fromDoc = typeof document !== "undefined" ? document.documentElement?.lang : "";
  const fromNavigator = typeof navigator !== "undefined" ? navigator.language : "";

  return (
    normaliseInterfaceLocale(fromConfig) ||
    normaliseInterfaceLocale(fromI18n) ||
    normaliseInterfaceLocale(fromDoc) ||
    normaliseInterfaceLocale(fromNavigator)
  );
}

export function resolveInterfaceLocalePreference(value: unknown): string {
  const candidate = normaliseInterfaceLocale(value);
  if (candidate === FOLLOW_OBSIDIAN_INTERFACE_LOCALE || candidate === "auto" || candidate === "follow-obsidian") {
    return FOLLOW_OBSIDIAN_INTERFACE_LOCALE;
  }
  return toSupportedManualLocale(candidate, DEFAULT_INTERFACE_LOCALE);
}

export function resolveInterfaceLocale(value: unknown): string {
  const preference = resolveInterfaceLocalePreference(value);
  if (preference === FOLLOW_OBSIDIAN_INTERFACE_LOCALE) {
    return toSupportedManualLocale(readObsidianLocalePreference(), OBSIDIAN_UNSUPPORTED_FALLBACK_LOCALE);
  }
  return toSupportedManualLocale(preference, DEFAULT_INTERFACE_LOCALE);
}

export function interfaceLocaleToIntlLocale(value: unknown): string {
  const resolved = resolveInterfaceLocale(value);
  if (resolved === "en-gb") return "en-GB";
  if (resolved === "en-us") return "en-US";
  if (resolved === "zh-cn") return "zh-CN";
  return "en-US";
}

export function getInterfaceLocaleLabel(code: string): string {
  const candidate = normaliseInterfaceLocale(code);
  if (candidate === "auto" || candidate === "follow-obsidian") {
    return getInterfaceLocaleLabel(FOLLOW_OBSIDIAN_INTERFACE_LOCALE);
  }
  const hit = INTERFACE_LOCALE_REGISTRY.find((locale) => locale.code === candidate);
  return (hit?.label ?? candidate) || "English (US)";
}
