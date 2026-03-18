# Syncing

Last modified: 17/03/2026

## Purpose

Syncing updates LearnKit's card database from your Markdown notes.

After creating, editing, or deleting card blocks, sync so changes take effect in your card database.

## Start Sync

- **Header button:** click the LearnKit sync button in any view when LearnKit is open.
- **Manual command:** run **LearnKit: Sync cards** from the command palette.
- **Automatic sync:** runs when editing cards in [Card Browser](./Card-Browser) or edit modals.


## Sync Steps

1. **Scan:** find card blocks in Markdown files.
2. **Parse:** read fields using the configured delimiter (default `|`).
3. **Match:** connect blocks with existing `^learnkit-#########` anchors to stored scheduling data.
4. **Create:** add new blocks that do not yet have anchors.
5. **Update:** refresh stored data for changed blocks.
6. **Remove:** delete cards whose source blocks were removed.
7. **Anchor:** insert `^learnkit-#########` above or below blocks (based on settings).

## Card Anchors

After syncing, each card block gets an anchor line:

```
^learnkit-#########
```

This anchor links note content to scheduling data.

Do not edit or delete it. If it is removed, next sync creates a new ID and previous progress is not linked to that block.

> [!TIP]
> If you remove an anchor by mistake, find the card ID in [Card Browser](./Card-Browser) and re-add the line.

## Quarantine

If a card block has invalid syntax, LearnKit quarantines it instead of deleting it.

See quarantined entries in Settings with error details, fix the note, then sync again.

## Exclusions

- **Fenced code blocks:** ignored by default (can be changed in Settings → Indexing).
- **Non-Markdown files:** not scanned.

## Related

- [Cards](./Cards)
- [Creating Cards](./Creating-Cards)
- [Backups](./Backups)
