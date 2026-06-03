---
title: "Syncing"
---


Syncing is how LearnKit turns supported content in your notes into up-to-date study material.

If you create, edit, move, or delete flashcards in Markdown, run sync so LearnKit can update its internal database.

## When To Sync

Run sync after you:

- add new cards to notes
- edit existing flashcard content
- delete card blocks
- import large amounts of content

If you do not sync, LearnKit may still show old flashcard data or fail to show new flashcards.

## How To Start A Sync

- Click the LearnKit sync button when available in the app UI.
- Run **LearnKit: Sync cards** from the command palette.
- Some edit flows, such as flashcard editing tools, may trigger sync-related updates automatically.

## What Sync Actually Does

1. Scans supported Markdown files for LearnKit flashcard content.
2. Parses fields using your current delimiter rules.
3. Matches existing card blocks to stored flashcard data.
4. Creates new flashcards for new blocks.
5. Updates changed flashcards.
6. Removes flashcards whose source blocks no longer exist.
7. Maintains card anchors that connect note content to review data.

## Card Anchors

After sync, LearnKit assigns an anchor like this to each tracked card block:

```
^learnkit-#########
```

This anchor links the note block to its stored scheduling state.

Do not remove or edit it unless you know exactly why. If the anchor changes, LearnKit may treat the block as a different card and previous progress may no longer attach to it.

## Why Cards Sometimes Do Not Appear

The most common causes are:

- sync has not been run yet
- the card syntax is invalid
- the content is inside an ignored area such as fenced code blocks
- the card was quarantined because parsing failed

If a card has invalid syntax, LearnKit quarantines it instead of silently deleting it. Fix the note, then sync again.

## Sync Privileges

Sync privileges control what sync is allowed to modify in your Markdown notes. You can set this in **Settings → User Details → Sync privileges**.

Four levels are available:

| Level | Behaviour |
|-------|-----------|
| **Full (Normalize)** | Scans canonical LearnKit syntax and shorthand codes, then converts shorthand into canonical LearnKit format. This can affect compatibility with other spaced-repetition plugins. In rare cases, other plugins that use `::` codes may be matched and converted. |
| **Full (Preserve)** | Scans canonical LearnKit syntax and shorthand codes, keeps existing shorthand structure, and appends LearnKit anchors. This is usually more compatible with other spaced-repetition plugins, but in rare cases `::` codes from other plugins may still be matched and anchored. |
| **Simple** | Scans canonical LearnKit syntax only and ignores new shorthand `::` patterns. This is the safest option for avoiding cross-plugin conflicts. |
| **Off** | Blocks all sync operations. You will see a notice directing you back to Settings if you try to sync. |

If you have never chosen a privilege level, the first sync attempt will show a one-time modal asking you to pick one. After this release, existing installs are also prompted once to confirm one of the updated mode names and descriptions.

### Editing Individual Cards

When you edit a flashcard through the Library, a study session, or the inline edit modal and save your changes, LearnKit automatically processes that card so your edits take effect.

To support additional fields such as extra info, titles, and groups, LearnKit always writes edited cards back in the canonical pipe-delimited format. This is required — without it the extra fields could not be saved. The rewrite affects only the card you edited.

The sync privilege you have chosen controls what else happens during the save:

| Privilege | Behaviour on card save |
|-----------|------------------------|
| **Full (Normalize)** | The whole note can be normalised — other cards in the same file may be updated to canonical LearnKit format as well. |
| **Full (Preserve)** | Keeps shorthand structure and appends LearnKit anchors where needed instead of converting shorthand to canonical format. |
| **Simple** | Processes canonical LearnKit syntax only and ignores new shorthand `::` parsing. |
| **Off** | The edited card is saved, but nothing else in the note is changed. |

## What Sync Ignores

- fenced code blocks by default
- non-Markdown files

Some indexing behavior can be changed in settings.

## Good Habit

The normal workflow is:

1. write or edit notes
2. run sync
3. verify flashcards in [Flashcard Library](../Flashcard-Library) if needed
4. start [Study Sessions](../Study-Sessions)

## Related

- [Creating Flashcards](../Creating-Flashcards)
- [Flashcard Library](../Flashcard-Library)
- [Backups](../Backups)

---

Last modified: 03/06/2026
