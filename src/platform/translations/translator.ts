/**
 * @file src/platform/translations/translator.ts
 * @summary Module for translator.
 *
 * @exports
 *  - t
 *  - tPlural
 *  - pluralSuffix
 */

import { DEFAULT_INTERFACE_LOCALE, resolveInterfaceLocale } from "./locale-registry";
import EN_BASE_JSON from "./locales/en-base.json";
import ZH_CN_JSON from "./locales/zh-cn.json";
import FR_JSON from "./locales/fr.json";
import JA_JSON from "./locales/ja.json";
import ES_JSON from "./locales/es.json";
import TOKEN_ALIASES_JSON from "./locales/token-aliases.json";

type TranslationVars = Record<string, string | number>;

const EN_BASE = EN_BASE_JSON as Readonly<Record<string, string>>;
const TOKEN_ALIASES = TOKEN_ALIASES_JSON as Readonly<Record<string, string>>;

const MESSAGE_BUNDLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "en-gb": EN_BASE,
  "en-us": EN_BASE,
  "zh-cn": ZH_CN_JSON as Readonly<Record<string, string>>,
  "fr": FR_JSON as Readonly<Record<string, string>>,
  "ja": JA_JSON as Readonly<Record<string, string>>,
  "es": ES_JSON as Readonly<Record<string, string>>,
};

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, key: string) => {
    const v = vars[key];
    return v == null ? `{${key}}` : String(v);
  });
}

export function t(
  locale: unknown,
  token: string,
  fallback: string,
  vars?: TranslationVars,
): string {
  const resolvedLocale = resolveInterfaceLocale(locale);
  const resolvedToken = TOKEN_ALIASES[token] ?? token;
  const primary = MESSAGE_BUNDLES[resolvedLocale]?.[resolvedToken];
  const english = MESSAGE_BUNDLES[DEFAULT_INTERFACE_LOCALE]?.[resolvedToken];
  const chosen = primary ?? english ?? fallback;
  return interpolate(chosen, vars);
}

/**
 * Returns "s" when count !== 1, "" otherwise.
 * Convenience for English-style plurals — translators for other languages
 * can override the full string via `tPlural` instead.
 */
export function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

/**
 * Translate with automatic plural suffix injection.
 * Adds `{count}` and `{suffix}` ("" or "s") to the vars automatically.
 * Translators for non-English locales can override the template entirely
 * using their own grammar rules since the full phrase is a single token.
 */
export function tPlural(
  locale: unknown,
  token: string,
  fallback: string,
  count: number,
  vars?: TranslationVars,
): string {
  return t(locale, token, fallback, {
    ...vars,
    count,
    suffix: pluralSuffix(count),
  });
}
