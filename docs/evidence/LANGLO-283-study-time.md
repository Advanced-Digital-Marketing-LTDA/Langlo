# LANGLO-283 daily study time

Date: 2026-10-23. Tracker task LANGLO-283 is due today.

## Behavior

The analytics tab shows a new "Study time" chart and a "Study time by day" table
below the existing review analytics. They show active minutes per study day for
flashcards, grammar and their total. Study days start at 04:00 in the learner's
saved timezone, or UTC when none is saved. A day without recorded time shows
"No Data"; with no recorded time at all, the chart and table each show
"No Data". The range starts at the earlier of the review-history start and the
first day with recorded time, within 365 study days, and ends today. Time is
never estimated from older review timestamps.

The timer runs on the flashcard review page (flashcards) and on the lesson and
assessment pages (grammar: grammar reviews, exercises, practice and
assessments). Within one page load, gaps of up to a minute between actions
count. A longer gap stops the timer at the last action, the pause counts as 0,
and the next action starts a new segment. Hiding the tab, leaving or reloading
the page ends the segment. If the learner moves to the analytics tab, its data
is refreshed once that last segment is saved. Each segment is saved once to
`POST /app/api/study-time` for the signed-in learner. Malformed segments, and
segments ending more than 60 seconds after the server clock (browser clocks can
run slightly ahead), longer than 24 hours or starting more than 7 days ago, are
rejected with 400 and not stored. Andrew approved these three limits.

## Data

Forward migration `0035_dapper_nehzno` adds `study_time_segments` (owner,
category, start, end), cascading on user deletion, with an owner/start index.
No earlier migration, snapshot or journal entry changed.

## Checks run

- Red: the new test files were run against base `origin/main` (ea57a44,
  without this PR's source). `study-timer`, `study-timer-attach`, `study-time`
  and `study-time-route` failed to load (`Cannot find module
'../src/lib/study-timer'`, `'../src/lib/server/study-time'`,
  `'../src/routes/app/api/study-time/+server'`), and both
  `study-time-render` cases failed (`expected '<!--[--><h1>Review
analytics</h1>…' to contain 'Study time'`). The tests were written alongside
  the implementation, so this red run was recorded afterwards, against the
  base.
- Green: `tests/study-timer.test.ts` (timer rules),
  `tests/study-timer-attach.test.ts` (pointer, key and input actions, the hidden
  tab, `pagehide` and cleanup, driven through real events),
  `tests/study-time.test.ts` (04:00 boundary split, timezone and UTC default,
  owner isolation, overlapping segments of one category counted once, each
  validation limit accepted exactly and rejected one past it),
  `tests/study-time-route.test.ts` (401 when signed out, owner taken from the
  session and never the body, 400 with no writes for malformed bodies) and
  `tests/study-time-render.test.ts` ("No Data" and minutes rendering) all pass,
  with 23 tests across them and `tests/review-analytics-render.test.ts`.
- Owner-approved test additions: migration `0035_dapper_nehzno` was appended
  to the pending-migration lists in `tests/db-migrations.test.ts` and
  `tests/portuguese-migration.test.ts`, its index names were added to the
  legacy-upgrade exclusion list, and `studyTime: []` was added to the page data
  in `tests/review-analytics-render.test.ts`. The expected migration lists and
  the exclusion list were extended for 0035; no check was removed. Those suites
  pass locally.
- The existing analytics loader cases in `tests/learner-journeys.test.ts`
  (unchanged) pass against a fully migrated database.
- Type check, lint and formatting pass on the changed files.
- The full suite was not run locally; CI runs it.

## Not verified

Deployment and live production behavior have not been verified.
