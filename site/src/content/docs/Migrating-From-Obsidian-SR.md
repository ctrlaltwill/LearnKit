---
title: "Migrating From Obsidian Spaced Repetition"
---


If you are coming from the [Obsidian Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) plugin, LearnKit automatically detects and converts your existing SR-format cards during sync. No manual reformatting is required.

## What Gets Migrated

LearnKit recognises three SR syntax styles and converts them into its canonical pipe-delimited format:

### Single-Line Cards

SR single-line basic and reversed cards share the same `::` / `:::` syntax that LearnKit uses as its preferred shorthand:

```
Paris::Capital of France
```

expands to:

```
Q | Paris |
A | Capital of France |
```

```
Paris:::Capital of France
```

expands to:

```
RQ | Paris |
A | Capital of France |
```

### Multi-Line Cards (`?` / `??`)

SR multi-line blocks use standalone `?` (basic) or `??` (reversed) as a separator between question and answer:

```
What is the capital of France?
?
Paris
```

This is merged into `What is the capital of France?::Paris` before parsing and expands identically to the single-line form.

```
What is the capital of France?
??
Paris
```

This is merged into `What is the capital of France?:::Paris` and becomes a reversed card.

### Cloze Deletions (`==text==`)

SR-style cloze deletions using `==…==` are converted automatically:

```
The capital of ==France== is ==Paris==
```

becomes:

```
cloze::The capital of {{c1::France}} is {{c2::Paris}}
```

Hints and sequence numbers are also supported:

```
The capital of ==France==^[country] is ==Paris==[^1]
```

| SR Syntax | LearnKit Equivalent |
|---|---|
| `==text==` | `{{c1::text}}` (auto-numbered) |
| `==text==^[hint]` | `{{c1::text::hint}}` |
| `==text==[^1]` | `{{c1::text}}` (fixed group) |
| `==text==^[hint][^2]` | `{{c2::text::hint}}` |

## How Migration Works

1. **Write** your SR-format cards as you normally would (or leave existing ones in place).
2. **Sync** your vault — LearnKit's sync engine pre-processes SR syntax before the main parser runs.
3. **Expand** — on the first sync, SR shorthand lines are expanded to canonical pipe-delimited format (with `Q |`, `RQ |`, or `CQ |` headers and `^learnkit-` anchors).

The conversion happens transparently. After sync your notes will contain LearnKit's canonical format, and scheduling data is preserved.

## Preferred Shorthand (Going Forward)

Once migrated, LearnKit's preferred shorthand for new cards is:

| Card Type | Shorthand | Example |
|---|---|---|
| Basic | `::` | `Question::Answer` |
| Reversed | `:::` | `Question:::Answer` |
| Cloze | `cloze::` / `cq::` / `CQ::` | `cloze::The {{answer}} is here` |

The SR `?` / `??` / `==text==` syntax is **only** used during migration. For new cards, stick to `::`, `:::`, and `cloze::`.

For full details on creating flashcards, see [Creating Flashcards](../Creating-Flashcards).

## What Is Never Treated As A Card

LearnKit's parser intentionally skips certain lines to avoid false positives:

### Markdown Headings

Lines that begin with `#`, `##`, `###` (up to `######`) are **never** parsed as flashcards, even if they contain `::`, `:::`, `cloze::`, `==text==`, or standalone `?` separators. Your section titles are safe.

### Code Fences

Content inside fenced code blocks (```` ``` ```` or `~~~`) is **never** scanned for cards. You can safely document LearnKit syntax inside code fences without creating accidental flashcards.

### Existing LearnKit Cards

Lines that already contain LearnKit pipe-delimited headers (`Q |`, `RQ |`, `CQ |`, etc.) or `^learnkit-` anchors are skipped by the SR pre-processor.

## Known Limitations

### Accidental `::` In Prose

In modes that parse shorthand (`Full (Normalize)` and `Full (Preserve)`), `::` appearing between two words in prose (e.g. `email::address`) can be treated as a basic card. This matches Obsidian Spaced Repetition's behavior and cannot always be distinguished from legitimate shorthand like `synonym::antonym`.

If this is a risk in your notes, switch to `Simple` sync privileges. That mode scans canonical LearnKit syntax only and ignores new shorthand `::` patterns.

## After Migration

- Review your cards in the [Flashcard Library](../Flashcard-Library) to confirm everything looks correct.
- Check [Decks & Organisation](../Decks-&-Organisation) if you want to assign groups or decks.
- Run a [Study Session](../Study-Sessions) to verify scheduling transferred properly.

## Related

- [Creating Flashcards](../Creating-Flashcards)
- [Import From Anki](../Import-From-Anki)
- [Syncing](../Syncing)
- [Obsidian Spaced Repetition (GitHub)](https://github.com/st3v3nmw/obsidian-spaced-repetition)
