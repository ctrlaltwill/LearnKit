# Multiple Choice Questions

Last modified: 17/03/2026

## Purpose

MCQ cards show one question with multiple options. You choose one answer.

## MCQ Format

Use `MCQ` for the question stem, `A` for the correct answer, and `O` for each incorrect option:

```
T | French Capitals |
MCQ | What is the capital of France? |
A | Paris |
O | London |
O | Berlin |
O | Madrid |
I | Remember: it's on the Seine |
G | Geography |
```

- `MCQ`: required question stem.
- `A`: required correct answer (one).
- `O`: required incorrect options (one or more).

## Modal Steps

1. Right-click in a note → **Add flashcard → MCQ Card**.
2. Enter the question stem.
3. Enter the correct answer.
4. Add incorrect options (click **Add option** for more).
5. Optionally add title, info, and groups.
6. Click **Save**.

## Review Flow

During review, options are shown as buttons. Select one option.

- Correct: selected option turns green, grade is **Good**.
- Incorrect: selected option turns red, correct option is highlighted, grade is **Again**.

> [!NOTE]
> MCQ grading is automatic. You do not press a separate grade button.

### Option Shuffle

By default, options stay in the order you wrote. Enable **Randomise MCQ options** in Settings -> Study to shuffle order each time.

## Grading

MCQs are **auto-graded** based on your selection:

| Your choice | Grade applied |
|---|---|
| Correct option | **Good** |
| Incorrect option | **Again** |

The FSRS scheduler then updates the card's scheduling data based on the grade, just like any other card type. See [Grading](./Grading) for more on how grading works.

## Tips

- Write plausible distractors (wrong options) — if options are obviously wrong, the card isn't testing real knowledge.
- Use MCQs for topics where distinguishing between similar items is the learning goal.
- Combine with the `I` field to explain why the correct answer is right.

## Related

- [Creating Cards](./Creating-Cards)
- [Grading](./Grading)
