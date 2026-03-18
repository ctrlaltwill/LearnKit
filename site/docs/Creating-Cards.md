# Creating Cards

Last modified: 17/03/2026

## Creation Paths

You can create cards with guided modals or by writing fields directly in markdown.

Modals are usually faster for [Image Occlusion](./Image-Occlusion) and [Multiple Choice Questions](./Multiple-Choice-Questions).

## Modal Method

1. Right-click in a note, or open the command palette (`Cmd/Ctrl+P`).
2. Choose an **Add flashcard** option.
3. Fill in the fields and select **Save**.

LearnKit inserts the card block at your cursor.

## Markdown Method

Card fields use the delimiter `|` by default (or your configured [delimiter](./Custom-Delimiters)).

| Field | Use | Required |
|---|---|---|
| `T` | Title | No |
| `Q` | Basic question | Yes (basic) |
| `A` | Answer / correct option | Yes (basic, MCQ) |
| `CQ` | Cloze text | Yes (cloze) |
| `MCQ` | MCQ stem | Yes (MCQ) |
| `O` | Incorrect MCQ option | At least one (MCQ) |
| `OQ` | Ordered-question stem | Yes (ordered) |
| `1`, `2`, `3`, ... | Ordered items (in correct sequence) | At least two (ordered) |
| `I` | Extra info | No |
| `G` | Groups (comma-separated) | No |

### Minimal examples

**Basic**
```
Q | What is the capital of France? |
A | Paris |
```

**Cloze**
```
CQ | The capital of France is {{c1::Paris}} |
```

**MCQ**
```
MCQ | What is the capital of France? |
A | Paris |
O | London |
O | Berlin |
```

See also:
- [Basic & Reversed Cards](./Basic-&-Reversed-Cards)
- [Cloze Cards](./Cloze-Cards)
- [Image Occlusion](./Image-Occlusion)
- [Multiple Choice Questions](./Multiple-Choice-Questions)
- [Ordered Questions](./Ordered-Questions)
- [Flags](./Flags)

## Multi-line fields

Fields can span multiple lines. The field ends at the closing delimiter.

```
Q | List three key features of X and include a diagram. |
A | Feature one

Feature two

![diagram.png](./diagram.png.md) |
I | Keep answers structured. |
```

## Card Anchors

After sync, each card block gets an anchor like:

```
^learnkit-#########
```

Do not edit or delete this line. It links the card to its scheduling data. If you remove it, the card is treated as new on sync and previous progress is lost. See [Syncing](./Syncing.md).

## Related

- [Cards](./Cards)
- [Editing Cards](./Editing-Cards)
- [Card Formatting](./Card-Formatting)
