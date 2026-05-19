/**
 * @file src/platform/translations/translator.ts
 * @summary Module for translator.
 *
 * @exports
 *  - t
 *  - tPlural
 *  - pluralSuffix
 *  - registerLocaleBundle
 *  - isLocaleLoaded
 *  - loadCommunityLocale
 *  - loadLocaleBundlesAsync
 */

import { DEFAULT_INTERFACE_LOCALE, resolveInterfaceLocale, getDownloadableLocales } from "./locale-registry";
import EN_BASE_JSON from "./locales/en-base.json";
import ZH_CN_JSON from "./locales/zh-cn.json";
import TOKEN_ALIASES_JSON from "./locales/token-aliases.json";

type TranslationVars = Record<string, string | number>;

const EN_BASE = EN_BASE_JSON as Readonly<Record<string, string>>;
const TOKEN_ALIASES = TOKEN_ALIASES_JSON as Readonly<Record<string, string>>;

/**
 * All loaded message bundles.  Built-in locales are populated at import time;
 * community (downloadable) locales are registered at runtime via
 * {@link registerLocaleBundle} or {@link loadCommunityLocale}.
 */
const MESSAGE_BUNDLES: Record<string, Readonly<Record<string, string>>> = {
  "en-gb": EN_BASE,
  "en-us": EN_BASE,
  "zh-cn": ZH_CN_JSON as Readonly<Record<string, string>>,
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

// ── Dynamic locale loading ──────────────────────────────────────────

/**
 * Register a locale bundle at runtime.  Safe to call multiple times; later
 * registrations overwrite earlier ones.
 */
export function registerLocaleBundle(code: string, bundle: Record<string, string>): void {
  MESSAGE_BUNDLES[code] = bundle;
}

/**
 * Returns true when the given locale code has a registered bundle.
 */
export function isLocaleLoaded(code: string): boolean {
  const resolved = resolveInterfaceLocale(code);
  return resolved in MESSAGE_BUNDLES;
}

/**
 * Read adapter for loading locale JSON files from disk.  Injected by the
 * plugin host so the pure translator module stays environment-agnostic.
 */
let _readFile: ((path: string) => Promise<string>) | null = null;

/**
 * Configure the file reader used by {@link loadCommunityLocale}.
 * Call once during plugin startup, e.g.:
 *   setLocaleFileReader((path) => app.vault.adapter.read(path))
 */
export function setLocaleFileReader(readFile: (path: string) => Promise<string>): void {
  _readFile = readFile;
}

/**
 * Load a community (downloadable) locale from a JSON file on disk.
 *
 * @param pluginDir - The plugin's directory path (e.g. `"path/.obsidian/plugins/learnkit"`).
 * @param code       - Locale code to load (e.g. `"fr"`, `"ja"`, `"es"`).
 * @returns true when the locale was loaded successfully, false otherwise.
 */
export async function loadCommunityLocale(pluginDir: string, code: string): Promise<boolean> {
  if (!_readFile) {
    console.warn("[translator] loadCommunityLocale: no file reader configured — call setLocaleFileReader() first");
    return false;
  }

  const resolved = resolveInterfaceLocale(code);
  if (resolved === "en-gb" || resolved === "en-us" || resolved === "zh-cn") {
    return true; // already bundled
  }

  const downloadable = getDownloadableLocales();
  if (!downloadable.includes(resolved)) {
    console.warn(`[translator] loadCommunityLocale: "${resolved}" is not a downloadable locale`);
    return false;
  }

  try {
    const jsonPath = `${pluginDir}/locales/${resolved}.json`;
    const raw = await _readFile(jsonPath);
    const bundle = JSON.parse(raw) as Record<string, string>;
    registerLocaleBundle(resolved, bundle);
    return true;
  } catch (err) {
    console.warn(`[translator] loadCommunityLocale: failed to load "${resolved}" from ${pluginDir}/locales/:`, err);
    return false;
  }
}

/**
 * Preloads any community locale bundles whose files exist on disk.
 * Call once during plugin startup so the user's selected locale is
 * available before the UI renders.
 *
 * @param pluginDir - The plugin's directory path.
 */
export async function loadLocaleBundlesAsync(pluginDir: string): Promise<void> {
  const downloadable = getDownloadableLocales();
  const results = await Promise.allSettled(
    downloadable.map((code) => loadCommunityLocale(pluginDir, code)),
  );

  const loaded = results.filter((r) => r.status === "fulfilled" && r.value).length;
  if (loaded > 0) {
    console.debug(`[translator] Preloaded ${loaded} community locale(s)`);
  }

  const failures = results.filter((r) => r.status === "rejected");
  for (const f of failures) {
    console.warn("[translator] Failed to preload a community locale:", f.reason);
  }
}
