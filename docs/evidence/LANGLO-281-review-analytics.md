# LANGLO-281 daily review analytics

Date: 2026-10-22. Tracker task LANGLO-281 is due today and remains In Progress.

## Behavior

The dashboard now shows separate grammar-review, flashcard, and total counts for
seven study days in the learner's saved timezone. Existing 04:00 study-day
boundaries are reused; overdue items count today. Grammar counts include only
available skills with a saved schedule. Flashcard counts include only the
learner's approved, unsuspended cards. Counts use persisted due times and do not
change schedules.

The Progress tab was removed from study navigation. The `/app/progress` route
and direct links remain available.

## Test-first evidence

Before implementation, the dashboard behavior tests failed as expected: the
weekly table and empty state were absent, and the Progress tab was still
rendered. The new dashboard-loader fixture test returned no `reviewDueByDay`
data. After implementation, the focused dashboard, loader, and analytics tests
passed (68 tests). The fixture covers timezone day boundaries, overdue cards,
owner isolation, suspended/rejected cards, the seven-day window, unchanged card
due times, and available versus unavailable or unscheduled grammar skills.

## Synthetic browser capture

[Dashboard screenshot](LANGLO-281-review-analytics.png) shows one overdue
synthetic flashcard due today and no saved grammar schedules. The browser run
used the disposable fixture database only.

## Local validation

Runtime: Node `24.19.0`, npm `11.9.0`. The clean install used
`npm ci --ignore-scripts`; no dependency or lockfile changes were made.

- `npm run check` — passed; 0 errors and 0 warnings.
- `npm run lint` — passed.
- `npm run format:check` — passed.
- `npm test` — passed; 105 files and 1,837 tests.
- `npm run test:property` — passed; 6 files and 9 tests.
- `npm run build` — passed.
- `npm run test:e2e` — passed; 142 desktop/mobile tests against the built Node
  server with synthetic fixtures.
- Focused dashboard browser capture — passed; 1 test.
- `git diff --check` — passed.

The clean install reported two moderate npm audit findings; they were not
investigated or changed in this task.

## Acceptance

Hosted PR checks and release acceptance are tracked separately from these local
results. No production database or live provider was used.
