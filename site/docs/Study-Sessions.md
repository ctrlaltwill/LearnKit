# Study Sessions

Last modified: 17/03/2026

## Session Flow

Study Sessions is where due cards are reviewed, graded, and scheduled. LearnKit uses FSRS to decide what appears and when.

## Start Session

You can start from:

- **Study page** — open the deck tree, pick a scope, and start.
- **Home page** — start from recent or pinned decks.
- **Deck widget (sidebar)** — starts from the currently open file context:
  - If the open file is a regular note, the session scope is that single note.
  - If the open file is a folder note (for example with [Folder Notes](https://github.com/LostPaul/obsidian-folder-notes)), the scope is that folder and its subfolders.

## Study Scope

Choose a scope (the set of cards to study):

| Scope | Covers |
|-------|--------|
| **Vault** | Every card in the vault |
| **Folder** | Cards in notes under a folder |
| **Note** | Cards in a single note |
| **Group** | Cards tagged with one or more groups |

## Queue Order

LearnKit queues cards in this order: **learning → relearning → review → new**.

Related siblings (for example cloze siblings and IO children) are spaced apart so they do not appear back-to-back.

## Daily Limits

| Setting | Default | Effect |
|---------|---------|--------|
| Daily new limit | 20 | Max new cards introduced per scope per day |
| Daily review limit | 200 | Max due cards shown per scope per day |

Limits reset at midnight and are tracked separately per scope.

## Answer Flow

Press **Space** or **Enter** to reveal the answer, then grade recall. See [Grading](./Grading).

## Practice Mode

Practice mode shows cards that are **not due yet**.

Cards are sorted by closest due date first.

Grades in Practice mode do **not** change scheduling.

## Session Timer

A session timer in the header shows elapsed time. Use play/pause controls to manage it.

## Auto Advance

If enabled in Settings, unanswered cards are auto-graded **Again** and advanced after a delay.

Allowed delay is 3 to 60 seconds (default 60). A countdown is shown.

## Skip Rules

Enable **Skip** in Settings -> Study.

Skipping pushes the card back in the queue and does **not** change scheduling.

| Skip count | Behaviour |
|------------|-----------|
| 1st | Card moves back in queue |
| 2nd | Card moves further back |
| 3rd | A **"Bury for today?"** prompt appears |

At that prompt: press `B` to bury, or `Escape` to dismiss.

## More Menu

Press `M` or tap the **⋮** button to open the More menu:

| Action | Shortcut | Description |
|--------|----------|-------------|
| Bury | `B` | Postpone card until tomorrow (see [Burying Cards](./Burying-Cards)) |
| Suspend | `S` | Remove card from future reviews (see [Suspending Cards](./Suspending-Cards)) |
| Undo | `U` | Revert the previous rating (only available on the next card) |
| Open note | `O` | Jump to the source note |
| Edit | `E` | Open the inline card editor |

## Image Zoom

Click any image during a review to open it in a full-screen overlay. Click again or press `Escape` to close.

## Time Tracking

LearnKit records time spent per card (capped at 5 minutes) for analytics.

## Related

- [Grading](./Grading)
- [Scheduling](./Scheduling)
- [Reminders](./Reminders)
- [Gatekeeper](./Gatekeeper)
