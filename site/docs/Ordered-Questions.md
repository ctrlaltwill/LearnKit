# Ordered Questions

Last modified: 17/03/2026

## Purpose

Ordered Question cards test whether you can place items in the correct sequence. LearnKit stores your list in the right order, then scrambles it during review.

Use this card type for steps, timelines, rankings, and other ordered lists.

## Ordered Format

Use `OQ` for the prompt and numbered fields (`1`, `2`, `3`, …) for items in the correct order:

```
T | Cardiac cycle |
OQ | Arrange the phases of the cardiac cycle in order |
1 | Atrial systole |
2 | Isovolumetric contraction |
3 | Ventricular ejection |
4 | Isovolumetric relaxation |
5 | Ventricular filling |
I | The cycle repeats with each heartbeat |
G | Cardiology |
```

- `OQ`: required question prompt.
- `1`, `2`, `3`, ...: ordered items. Add at least 2 items.

If item order is wrong in the note, LearnKit will treat that wrong order as the answer key.

## Modal Steps

1. Right-click in a note → **Add flashcard → Ordered Question Card**.
2. Enter the prompt.
3. Add items in the correct order.
4. Optionally add title, info, and groups.
5. Click **Save**.

You can drag items up or down before saving.

## Review Flow

During review, items appear in a scrambled order. Arrange them into the correct sequence.

After you submit:

- If all positions are correct, the card is graded **Good**.
- If any position is wrong, the card is graded **Again** and the correct order is shown.

## Grading

Ordered Questions are auto-graded:

| Your arrangement | Grade applied |
|------------------|--------------|
| Fully correct order | **Good** |
| Any items out of order | **Again** |

The scheduler then updates the card from that grade. See [Grading](./Grading).

## Tips

- Keep lists short (about 3 to 7 items) so reviews stay manageable.
- Use clear item text so similar options are not easy to confuse.
- Add context in `I` if the order needs explanation.

## Related

- [Creating Cards](./Creating-Cards)
- [Study Sessions](./Study-Sessions)
