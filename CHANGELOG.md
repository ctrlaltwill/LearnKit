# Changelog

All notable changes to LearnKit are summarized here.

## 1.7.0 (2026-06-24)

### Added
- Redesigned sync mode picker with dropdown and four modes: Simple (recommended), Full (Normalize), Full (Preserve), Off.
- Simple sync mode: scans only canonical LearnKit syntax, skipping shorthand `::` patterns to avoid plugin conflicts.
- `shorthandMode` parser option (`all` / `anchored-only` / `off`) for controlling shorthand detection.
- Sync privilege choice versioning helpers for upgrade detection.

### Changed
- Sync modal intro now recommends Simple mode as the default for new users.
- Sync mode descriptions rewritten for clarity.
- Session dock layout now adapts responsively at narrow window sizes.

### Fixed
- Math `\\` line breaks inside LaTeX blocks no longer collapsed during markdown rendering.
- Open Question submit button now responds reliably.
- TeX commands (like `\begin`) in card fields no longer mangled on read-back.
- Stale i18n audio keys cleaned from en-gb, en-us, zh-cn locales.
- Hardcoded hint label in parse error modal now routed through translation system.
- Lint: 8 errors fixed (style assignments, innerHTML usage, unnecessary assertion).

## Unreleased

- Draft release notes for `1.2.0`: see [release/1.2.0/RELEASE_NOTES.md](release/1.2.0/RELEASE_NOTES.md)

## 1.5.3 (2026-05-16)

### Note
This release is a duplicate of 1.5.1, re-submitted for Obsidian Community Plugins approval.
Version 1.5.2 was repealed/reverted due to issues encountered during the approval review process.
There are no functional changes relative to 1.5.1.

## 1.5.1 (2026-05-15)

### Changed
- Updated CSS color literals to full 6-digit hex format for lint and approval consistency.
- Added automated CSS hex normalization in the build pipeline for release artifact compliance.
- Included approval-readiness compatibility tidy-ups for Obsidian Community Plugins review.

### Added
- Added Tests for auto-generating study tests.
- Added Coach workflows for guided study prompts.
- Added Note Review workflows.

### Changed
- Updated colour palette for grading buttons.

<details open>
<summary><strong>Latest release: 1.1.0 (2026-03-10)</strong></summary>

### Release notes

Hotfix release focused on reliability and widget UX improvements after 1.0.7.

#### Added
- Added transfer of active study context/session from the widget into the main LearnKit Study tab
- Refreshed plugin iconography in branding assets

#### Changed
- Updated widget launch behavior to open from command palette instead of auto-opening on app reload
- Updated widget colors for better readability in non-translucent windows

#### Fixed
- Adjusted z-index layering for study buttons and modals to prevent overlap conflicts
- Fixed modal launching behavior for more reliable open/close interactions
- Fixed modal sizing to render consistently across screen sizes
- Improved mobile layout to prevent UI elements from being obstructed
- Fixed zoom interaction conflicts with other plugins

#### Links
<a href="https://github.com/ctrlaltwill/LearnKit/issues" style="display:inline-block;padding:6px 12px;margin-right:8px;border:1px solid #1f6feb;border-radius:6px;text-decoration:none;color:#1f6feb;">GitHub issues</a>
<a href="https://github.com/ctrlaltwill/LearnKit/wiki" style="display:inline-block;padding:6px 12px;border:1px solid #1f6feb;border-radius:6px;text-decoration:none;color:#1f6feb;">Documentation wiki</a>
</details>

<details>
<summary><strong>1.0.7 (2026-02-26)</strong></summary>

### Release notes

Hotfix release focused on minor bugs identified after 1.0.5 and 1.0.6.

#### Fixed
- Fixed modal launching behavior for more reliable open/close interactions
- Fixed modal sizing to render consistently across screen sizes
- Improved mobile layout to prevent UI elements from being obstructed
- Fixed zoom interaction conflicts with other plugins

#### Links
<a href="https://github.com/ctrlaltwill/LearnKit/issues" style="display:inline-block;padding:6px 12px;margin-right:8px;border:1px solid #1f6feb;border-radius:6px;text-decoration:none;color:#1f6feb;">GitHub issues</a>
<a href="https://github.com/ctrlaltwill/LearnKit/wiki" style="display:inline-block;padding:6px 12px;border:1px solid #1f6feb;border-radius:6px;text-decoration:none;color:#1f6feb;">Documentation wiki</a>
</details>

<details>
<summary><strong>1.0.6 (2026-02-18)</strong></summary>

### Release notes

This release focuses on compatibility updates required for Obsidian Community Plugins linter checks during approval.

#### Changed
- Updated plugin code and metadata for compatibility with Obsidian Community Plugins linter requirements
- Performed targeted compatibility tidy-up to support the approval process

#### Fixed
- Addressed linter-related compatibility findings that could block community plugin approval

#### Note
This is a compatibility and approval-readiness release, with no user-facing feature changes.

#### Links
<a href="https://github.com/ctrlaltwill/LearnKit/issues" style="display:inline-block;padding:6px 12px;margin-right:8px;border:1px solid #1f6feb;border-radius:6px;text-decoration:none;color:#1f6feb;">GitHub issues</a>
<a href="https://github.com/ctrlaltwill/LearnKit/wiki" style="display:inline-block;padding:6px 12px;border:1px solid #1f6feb;border-radius:6px;text-decoration:none;color:#1f6feb;">Documentation wiki</a>
</details>

<details>
<summary><strong>1.0.5 (2026-02-18)</strong></summary>

### Release notes

This stable release builds on the features delivered in `1.0.5-beta.1`.

#### Added
- Added new card types: multi-select MCQ and ordered questions for memorising sequences
- Added more card customisation: typed cloze and customisation of image occlusion masks
- Overhauled Reading view with two styles: Flashcards and Clean markdown
- Added a new settings view with more control
- Updated the guide and made it visible directly within Obsidian

#### Fixed
- Limited modal background/overlay to the workspace so tab-switching remains available

#### In development
- Mobile functionality support, building on this release
- Continued bug-fix and stability work
- Reading view improvements and expanded style support
- Codebase tidy-up to improve long-term extensibility

#### Hint
If scheduling or analytics data is lost after an update, restore from a backup.

#### Links
<a href="https://github.com/ctrlaltwill/LearnKit/issues" style="display:inline-block;padding:6px 12px;margin-right:8px;border:1px solid #1f6feb;border-radius:6px;text-decoration:none;color:#1f6feb;">GitHub issues</a>
<a href="https://github.com/ctrlaltwill/LearnKit/wiki" style="display:inline-block;padding:6px 12px;border:1px solid #1f6feb;border-radius:6px;text-decoration:none;color:#1f6feb;">Documentation wiki</a>
</details>
