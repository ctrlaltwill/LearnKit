### Release Date
2026-06-24

### Summary
LearnKit 1.7.1 is a patch release with internal hotfixes for lint compliance. No functional changes.

---

### Hotfixes

- Replaced direct `innerHTML` assignments with sanitized `replaceChildrenWithHTML` across cloze and code-fence rendering paths (parse error modal, gatekeeper, reviewer, widget session).
- Switched bare `document` references to `activeDocument` in chart color resolution for popout window compatibility.
- Replaced `instanceof HTMLElement` checks with cross-window-safe `nodeType` comparisons in tooltip mutation observer.
- Fixed bare `setTimeout` usage in browser preferences persistence.
- Resolved TypeScript unsafe-type warnings in the docs site content config.
