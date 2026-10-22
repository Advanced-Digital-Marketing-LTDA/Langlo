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
due times, and available versus unavailable or unscheduled grammar skills. The
analytics unit test exercises its flashcard query against in-memory SQLite.

## Review follow-up

Caught auth-resolution and sign-out exceptions now emit the existing safe auth
diagnostic and return a 503 retry message. The dashboard renders action failures
as an alert beside the sign-out button. Failure paths retain the session cookie;
successful sign-out still applies the auth response cookies before redirecting.
Diagnostics contain an error category and validated request correlation ID,
without exception messages or credential values.

Before the fix, the new sign-out action and rendered-alert regressions failed
(2 failed, 67 passed). After the fix, the three focused suites passed (70 tests).

The renamed flashcard integration test now freezes the clock and includes a
card due at 2026-10-23 05:00 UTC: October 22's study day in Sao Paulo and October
23's study day in UTC. Temporarily forcing the loader to UTC made this test
fail with counts of 2 today and 2 tomorrow instead of 3 today and 1 tomorrow.
The mutation was restored before the passing focused run. The test continues
to check owner isolation, eligibility and unchanged due times.

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
- `npm test` — passed; 105 files and 1,839 tests.
- `npm run test:property` — passed; 6 files and 9 tests.
- `npm run build` — passed.
- `npm run test:e2e` — 141 passed, 1 failed against the built Node server
  with synthetic fixtures. The unchanged mobile map fast-exit timer test
  failed at `tests/e2e/exercises.spec.ts:786` (`mapTimerPending` was true).
  Desktop map fast-exit and both desktop/mobile sign-out flows passed.
- `git diff --check` — passed.

The follow-up browser run used the default port 4173. The initial implementation
passed all 142 browser tests using a temporary port-4174 config because 4173 was
then occupied. The same map timer assertion also failed in the PR workflow on
the previous commit, while its push workflow passed. The map implementation and
its browser test remain unchanged in this follow-up.

An isolated recheck using `npm run test:e2e -- tests/e2e/exercises.spec.ts
--grep 'freshly scrolled map' --repeat-each=2` produced 3 passes and 1 desktop
failure at the same timer assertion. This confirms the failure is intermittent;
the browser suite is not recorded as passing for this follow-up.

The clean install reported two moderate npm audit findings; they were not
investigated or changed in this task.

## Acceptance

Hosted PR checks and release acceptance are tracked separately from these local
results. No production database or live provider was used.
