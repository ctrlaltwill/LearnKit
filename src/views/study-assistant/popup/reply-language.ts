/**
 * @file src/views/study-assistant/popup/reply-language.ts
 * @summary Builds the "reply in this language" instruction that is prepended to
 *   every AI request (Ask, Review, Generate flashcards, Generate tests).
 *
 *   The instruction needs an *actual* language name plus a real locale code.
 *   Passing the raw `general.interfaceLanguage` preference straight through was
 *   the defect behind issue #218: with the default "Match Obsidian" preference
 *   the model was sent `Use English (obsidian) …`, so every AI feature answered
 *   in English regardless of the host locale. Callers resolve the preference
 *   first (see `resolveInterfaceLocale`) and hand the resolved code in here.
 *
 * @exports
 *   - assistantReplyLanguageName — locale code → English name of that language
 *   - buildReplyLanguageInstruction — locale code → full sentence for the model
 */

/**
 * Maps a resolved locale code (`zh-cn`, `ja`, `en-gb`, …) to the language name
 * used in the prompt. Matching is on the primary subtag, so `zh-cn`/`zh-tw` both
 * map to Chinese.
 *
 * Keep this in step with the locale registry: `tests/reply-language.test.ts`
 * fails if a supported locale has no name here.
 */
export function assistantReplyLanguageName(localeCode: string): string {
  const primary = String(localeCode || "en").split("-")[0].trim().toLowerCase();
  switch (primary) {
    case "zh":
      return "Simplified Chinese";
    case "ja":
      return "Japanese";
    case "ko":
      return "Korean";
    case "es":
      return "Spanish";
    case "fr":
      return "French";
    case "de":
      return "German";
    case "pt":
      return "Portuguese";
    case "it":
      return "Italian";
    case "ru":
      return "Russian";
    case "ar":
      return "Arabic";
    case "hi":
      return "Hindi";
    default:
      return "English";
  }
}

/**
 * The sentence handed to the model. `localeCode` must already be resolved
 * (never the `"obsidian"` preference token).
 */
export function buildReplyLanguageInstruction(localeCode: string): string {
  const code = String(localeCode || "").trim() || "en";
  return `Use ${assistantReplyLanguageName(code)} (${code}) for your response unless the user explicitly requests a different language.`;
}
