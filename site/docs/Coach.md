# Coach

Last modified: 18/03/2026

## What Coach Does

Coach helps you build focused study plans for exams and tests. You select the notes, folders, or groups you want to study, set an exam date, and Coach creates a personalised daily plan with targets for both flashcards and note reviews.

## Creating a Plan

1. Open **Coach** from the sidebar.
2. Click **Get started** (or **+ New plan** if you already have one).
3. **Topics** — search and select the notes, folders, groups, or entire vault you want to include.
4. **Schedule** — set your exam date and choose an intensity level (relaxed, balanced, or aggressive).
5. **Review** — check the summary and click **Start plan**.

Coach calculates daily flashcard and note targets based on how much material is in scope, how many days remain, and your chosen intensity.

## Daily Progress

Each plan shows a progress bar for the current day — how many flashcards and notes you have completed versus your daily target. A remaining line tells you exactly what is left for today.

From the plan card you can:

- **Study flashcards** — opens the reviewer scoped to your plan material.
- **Review notes** — opens note review scoped to your plan.
- **Generate practice test** — creates an exam-style test from your plan content.

## How Health Scores Work

The **Study Plan Health** panel shows three bars: Flashcards, Notes, and Exam. Each is a 0–100 score.

### Flashcard Health

Flashcard health blends two things:

- **Mastery of studied cards** — for every flashcard you have already reviewed, Coach reads its memory strength from the spaced repetition algorithm (FSRS). Cards you know well contribute a high score; cards whose memory has faded pull it down.
- **Time feasibility for unstudied cards** — for cards you have not yet started, Coach asks: "Given the daily target and the days remaining, is there enough time to get through them all before the exam?" If there is plenty of runway, this portion scores well. If the exam is tomorrow and hundreds of new cards remain, it scores poorly.

The final flashcard health is a weighted blend of these two. Material you have actually studied and retained counts at full weight; material you *could* study in the time remaining is discounted slightly, because having the capacity to study something is not the same as knowing it.

### Note Health

Note health works the same way — reviewed notes weighted by retention, plus time feasibility for notes you have not yet reviewed.

### Exam Health

Exam health is simply a weighted average of your flashcard and note health scores, giving a single at-a-glance number for overall readiness.

### What the Labels Mean

| Label | Meaning |
|---|---|
| Ready | Strong mastery and comfortable time margin |
| On track | Good progress, no immediate concern |
| At risk | Some gaps — either fading retention or tight schedule |
| Behind | Significant gaps in mastery or insufficient time remaining |

## How the Readiness Chart Works

The **Exam Readiness** chart tracks a 0–100 readiness score from plan creation through to exam day.

- The **solid line** shows your actual readiness over past days. Each point combines how much of the material you have studied and how well you remember it (via the spaced repetition memory model), blended with time feasibility for the material you have not yet reached.
- The **dashed line** projects your readiness into the future, assuming you follow your daily targets from today onward. It models how existing card memories will naturally decay over time, offset by the reviews you are expected to complete, which restore memory strength.

On day one of a feasible plan with plenty of time, readiness starts moderately high — you have not learned anything yet, but there is ample runway to cover the material. As the exam approaches, the feasibility window shrinks, so readiness increasingly depends on what you have actually studied and how well you remember it.

If you fall behind your targets, the actual line diverges from the projection, making it easy to spot when you need to catch up.

## Best Practices

- **Start early** — the further out your exam date, the more forgiving the daily targets.
- **Study consistently** — short daily sessions maintain memory strength better than cramming.
- **Check the health bars** — if flashcard health is dropping, it usually means old cards need review; if note health is low, you have unreviewed notes piling up.
- **Adjust intensity** — if targets feel unsustainable, edit the plan and switch to a more relaxed intensity.

## Related

- [Scheduling](./Scheduling)
- [Flashcards](./Flashcards)
- [Tests](./Tests)
- [Study Sessions](./Study-Sessions)
