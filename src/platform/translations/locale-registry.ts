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
import {  } from "obsidian";

export type InterfaceLocaleDefinition = {
  code: string;
  label: string;
  nativeLabel: string;
  flagCode?: string;
  status: "stable" | "community";
  /** Whether the locale bundle is statically bundled (works offline immediately). */
  builtin: boolean;
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
    builtin: true,
  },
  {
    code: "en-gb",
    label: "English (UK)",
    nativeLabel: "English (United Kingdom)",
    flagCode: "en-gb",
    status: "stable",
    builtin: true,
  },
  {
    code: "en-us",
    label: "English (US)",
    nativeLabel: "English (United States)",
    flagCode: "en-us",
    status: "stable",
    builtin: true,
  },
  {
    code: "zh-cn",
    label: "Chinese (Simplified)",
    nativeLabel: "简体中文",
    flagCode: "cn",
    status: "community",
    builtin: true,
  },
  {
    code: "fr",
    label: "French",
    nativeLabel: "Français",
    flagCode: "fr",
    status: "community",
    builtin: false,
  },
  {
    code: "ja",
    label: "Japanese",
    nativeLabel: "日本語",
    flagCode: "jp",
    status: "community",
    builtin: false,
  },
  {
    code: "es",
    label: "Spanish",
    nativeLabel: "Español",
    flagCode: "es",
    status: "community",
    builtin: false,
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
  if (candidate === "fr" || candidate.startsWith("fr")) return "fr";
  if (candidate === "ja" || candidate.startsWith("ja")) return "ja";
  if (candidate === "es" || candidate.startsWith("es")) return "es";

  return MANUAL_INTERFACE_LOCALE_SET.has(candidate) ? candidate : fallback;
}

function readObsidianLocalePreference(): string {
  type AppHost = { app?: { vault?: { getConfig?: (key: string) => unknown }; i18n?: { locale?: unknown } } };
  const host: AppHost = typeof window !== "undefined"
    ? (window as Window & AppHost)
    : {} as AppHost;
  const app = host.app;
  const fromConfig = app?.vault?.getConfig?.("locale");
  const fromI18n = app?.i18n?.locale;
  const fromDoc = typeof document !== "undefined" ? activeDocument.documentElement?.lang : "";
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
  if (resolved === "fr") return "fr-FR";
  if (resolved === "ja") return "ja-JP";
  if (resolved === "es") return "es-ES";
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

/**
 * Returns true when the locale is bundled statically (no download needed).
 * Non-builtin locales are shipped as separate JSON files in `locales/`
 * and loaded on demand.
 */
export function isBuiltinLocale(code: string): boolean {
  const candidate = normaliseInterfaceLocale(code);
  if (candidate === FOLLOW_OBSIDIAN_INTERFACE_LOCALE) return true;
  const hit = INTERFACE_LOCALE_REGISTRY.find((locale) => locale.code === candidate);
  return hit?.builtin ?? true; // unknown locales fall back to English (builtin)
}

/**
 * Lists community locale codes that can be downloaded.
 */
export function getDownloadableLocales(): string[] {
  return INTERFACE_LOCALE_REGISTRY
    .filter((l) => !l.builtin && l.code !== FOLLOW_OBSIDIAN_INTERFACE_LOCALE)
    .map((l) => l.code);
}
