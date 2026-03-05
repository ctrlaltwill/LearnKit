# Localization Debt Backlog

This file tracks known user-facing hardcoded strings that should be tokenized.

## Migration Order (Highest Traffic First)

1. `src/views/settings/sprout-settings-tab.ts`
Token target: `ui.settings.*`
Scope: section headings, setting names/descriptions, placeholders, backup table labels, action button text.

2. `src/platform/modals/anki-import-modal.ts`
Token target: `ui.modal.ankiImport.*`
Scope: step headings, helper copy, button labels, progress status labels, warnings/errors.

3. `src/platform/modals/anki-export-modal.ts`
Token target: `ui.modal.ankiExport.*`
Scope: action labels, summary labels, progress states, notices.

4. `src/views/settings/confirm-modals.ts`
Token target: `ui.modal.confirm.*`
Scope: destructive action titles/body copy/buttons and related notices.

5. `src/views/reviewer/render-session.ts`
Token target: `ui.study.*`
Scope: reviewer controls, menu labels, aria-labels, submit/reveal text.

6. `src/views/reminders/gatekeeper-modal.ts`
Token target: `ui.gatekeeper.*`
Scope: bypass copy, question/answer headings, reveal/continue actions.

7. `src/platform/card-editor/card-editor.ts`
Token target: `ui.editor.*`
Scope: editor labels, hints, empty states, notices.

8. `src/main.ts`
Token target: `ui.command.*` and `ui.notice.*`
Scope: command names, menu labels, startup/runtime notices.

## Namespace Guidelines

- `ui.common.*`: globally reused actions (`cancel`, `save`, `next`, `previous`, `back`, `close`).
- `ui.notice.*`: toasts and runtime feedback.
- `ui.modal.*`: modal-specific headings/descriptions/actions.
- `ui.settings.*`: settings tab and subpage labels.
- `ui.command.*`: command palette/ribbon/menu naming.

## Process

1. Add token(s) to `src/platform/translations/locales/en-gb.json`.
2. Mirror keys in `src/platform/translations/locales/en-us.json` and `src/platform/translations/locales/en-gb.json`.
3. Replace literals with `t(...)` or a scoped helper (`txCommon(...)`).
4. Run `npm run translations:check` and `npm run i18n:literals:check`.

## Guardrail

- Baseline-aware literal checker: `tooling/check-i18n-literals.mjs`
- Baseline file: `tooling/i18n-literal-baseline.json`
- Check command: `npm run i18n:literals:check`
