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
the page ends the segment. Each segment is saved once to
`POST /app/api/study-time` for the signed-in learner. Malformed segments, and
segments ending more than 60 seconds after the server clock (browser clocks can
run slightly ahead), longer than 24 hours or starting more than 7 days ago, are
rejected with 400 and not stored. Andrew approved these three limits.

## Data

Forward migration `0035_dapper_nehzno` adds `study_time_segments` (owner,
category, start, end), cascading on user deletion, with an owner/start index.
No earlier migration, snapshot or journal entry changed.

## Checks run

- New tests: `tests/study-timer.test.ts`, `tests/study-time.test.ts`,
  `tests/study-time-render.test.ts` (12 passed). They cover the 60-second idle
  stop, hidden tab and page exit, the 04:00 boundary split, timezone and UTC
  default, owner isolation, validation and "No Data" rendering.
- Owner-approved test additions: migration `0035_dapper_nehzno` was appended
  to the pending-migration lists in `tests/db-migrations.test.ts` and
  `tests/portuguese-migration.test.ts`, its index names were added to the
  legacy-upgrade exclusion list, and `studyTime: []` was added to the page data
  in `tests/review-analytics-render.test.ts`. The expected migration lists and
  the exclusion list were extended for 0035; no check was removed. These
  suites and the new ones pass (45 tests).
- The existing analytics loader cases in `tests/learner-journeys.test.ts`
  (unchanged) pass against a fully migrated database.
- Type check, lint and formatting pass on the changed files.
- The full suite was not run locally; CI runs it.

## Not verified

Deployment and live production behavior have not been verified.
