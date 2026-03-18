# Flags

Last modified: 04/03/2026

## Overview

LearnKit supports inline circle flags inside card text fields using token syntax.
Flag assets are provided by [HatScripts/circle-flags](https://github.com/HatScripts/circle-flags) (MIT).

Supported token formats:

- `{{es}}`

These render as small circular flag icons with diameter matching the current text size.

## Full code reference

Use [Flag-Codes](./Flag-Codes.md) for full code tables:

- Country and territory codes
- State/region codes grouped by country (country in first column)
- Language codes

## Where flags work

Flags are supported in all text content fields:

- `T` (title)
- `Q` / `RQ` / `CQ` / `MCQ` / `OQ` (question/stem fields)
- `A` and `O` (answers/options)
- Ordered-question steps (`1`, `2`, `3`, ...)
- `I` (extra information)

Flags are **not** supported in `G` (groups).

## Editing behavior

In card editors and browser inputs:

- when the field is focused, you see raw tokens (for example `{{gb}}`)
- when the field loses focus, tokens render as flag icons

This matches LearnKit’s existing image-preview editing style.

## Display behavior

Flags render in:

- Study mode
- Widget mode
- Gatekeeper mode
- Reading view / pretty-card rendering

They are also used by [TTS](./Text-to-Speech.md) when flag-aware routing is enabled.

## Examples

Basic language-pair card:

```
Q | {{es}} Hola |
A | {{gb}} Hello |
```

State card example:

```
Q | {{us-ca}} California |
A | {{gb}} West Coast, United States |
```

## Syntax and compatibility notes

- LearnKit keeps cloze syntax untouched (`{{c1::...}}`, `{{c2::...}}`, etc.).
- Invalid flag tokens are left as plain text.
- Flags use circle-flag asset codes (country/region style codes), not free-form language names.

## Offline cache behavior

Flags are fetched on demand and cached locally.

- first render of a new code may require network
- after fetch, cached data is used offline
- cache is bounded (LRU-style trimming) to avoid unbounded growth

This keeps plugin size small while still supporting offline use after first load.

## TTS behavior with flags

When **Settings → Audio → Flag-aware routing → Use flags for language and accent** is enabled:

- `{{es}}` routes speech to Spanish voices.
- A single flag can apply to the full spoken text (not position-dependent).
- Multiple flags in one field use segmented inline voice switching.

Optional setting:

- **Speak language name before flag segments** adds spoken labels before each flag-switched segment.
	- Example labels are language names such as **English** or **Spanish**.
	- Regional accent selection still applies (for example UK/US English voices).

## Tips

- Use short, consistent codes in language decks (`{{es}}`, `{{fr}}`, `{{de}}`).
- If you prefer UK/US distinction in English prompts, use explicit tokens such as `{{gb}}` or `{{us}}`.
- Combine flags with TTS for mixed-language cards, for example `{{es}}` question + `{{gb}}` answer.
