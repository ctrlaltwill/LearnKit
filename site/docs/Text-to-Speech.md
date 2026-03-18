# Text to Speech

Last modified: 17/03/2026

## Purpose

Text to Speech (TTS) can read card content aloud.

This helps with language study, listening practice, and accessibility.

LearnKit also supports flag-aware voice routing with [inline flag tokens](./Flags).
Flag assets are provided by [HatScripts/circle-flags](https://github.com/HatScripts/circle-flags) (MIT).

## Card Support

| Card type | TTS support | What's read |
|-----------|-------------|-------------|
| **Basic** | ✅ | Question and/or answer fields |
| **Cloze** | ✅ | Full sentence or just the cloze deletion (configurable) |
| **MCQ** | ✅ | Question stem and options |
| **Ordered** | ✅ | Question stem and items |
| **Image Occlusion** | ❌ | Not supported (visual cards) |

If a card type is unsupported, no TTS audio is generated for that card.

## Cloze Modes

For cloze cards, choose what is read on the answer side:

| Option | Behaviour |
|--------|-----------|
| **Deletion only** | Reads only the hidden/deleted text (e.g. "Paris") |
| **Full sentence** | Reads the complete sentence with the deletion filled in (e.g. "The capital of France is Paris") |

Configure this in Settings -> Audio -> Cloze TTS mode.

## Enable Steps

1. Go to **Settings → Audio**.
2. Toggle **Enable text-to-speech** on.
3. Choose voice and language (see [Language Settings](./Language-Settings)).
4. TTS controls will appear in the study session interface.

## Flag Routing

In Settings -> Audio -> Flag-aware routing:

- **Use flags for language and accent** (default: on)
	- `{{es}}` and `{{es-mx}}` can switch spoken language/accent.
	- A single flag anywhere in the text can apply to the full spoken content.
	- Multiple flags in one field use segmented speaking (voice switches inline).
- **Speak language name before flag segments** (default: off)
	- Adds a spoken language prefix before each flag-switched segment.
	- English variants use the label **English** while keeping regional accent (for example UK/US voice choice).

See [Flags](./Flags) for token syntax and supported formats, and [Flag Codes](./Flag-Codes) for available language/region codes.

## Session Controls

When TTS is enabled:

- A **speaker icon** appears on cards during review.
- Click it to hear the current side read aloud.
- Auto-play can be configured to read automatically when a card is shown or when the answer is revealed.

## Voice Quality

TTS uses your device's built-in speech engine. Voice quality and available voices depend on your OS:

- **macOS** — High-quality voices available via System Preferences → Accessibility → Spoken Content.
- **Windows** — Voices available via Settings → Time & Language → Speech.
- **Linux** — Depends on the installed speech synthesis packages.
- **Mobile** — Uses the device's built-in TTS engine.

If no suitable voice is installed for your chosen language, pronunciation quality may be poor.

## Tips

- For language learning, set the voice language to match your target language.
- Use **deletion only** mode for cloze cards when you want to practise pronunciation of specific terms.
- Use **full sentence** mode when context and sentence flow matter.
- Use inline flags when a single card mixes languages or accents.
