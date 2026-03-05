### Release Date
2026-03-05

### Summary
Sprout 1.0.9 adds new study features, better backups, better support for LaTeX, more security settings, and updated docs and translation support.

## What's Changed

### Added
- Added reminders and gatekeeper popups to remind you when cards are due and encourage regular review.
- Added translation framework support to prepare for future crowd-sourced translations.
- Added flag tokens (see below).

### Flags
- Added inline language flag tokens in card text as visual hints for language learning (for example `{{es}}` and `{{gb}}`).
- Example: `Q | {{es}} Hola |` and `A | {{gb}} Hello |` shows a clear visual cue for each language and helps learners switch context faster.
- Added flag-aware audio routing: in **Settings → Audio → Flag-aware routing**, the same flags can route TTS to a matching language/accent voice (with optional spoken language labels). This improves TTS voice detection.

### Changed
- Updated colour palette for grading buttons.
- Improved LaTeX rendering consistency across Study, Widget, and Reading views.
- Added support for clozes inside LaTeX content within questions.
- Improved data backup reliability and recovery behaviour.
- Added options to control how your card data is backed up.

### Fixed
- Improved clarity of revealed answers for ordered questions.

### Documentation
- New wiki pages for added features, plus updated pages for modified content.
- Updated the documentation website to utilise VitePress for online users.
