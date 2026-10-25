# Grammar review finishes once every topic is answered

Date: 2026-10-24. Requested and approved by Andrew in the project thread.

## Behavior

- A grammar review finishes by itself when its last topic is reviewed: when
  that topic's difficulty rating is saved, or when its answer is recorded if
  it takes no rating (incorrect, Not sure, uncertain). Finishing is the same
  as pressing "Finish session": the topics' schedules update.
- A correct answer still waiting for its rating does not finish the review:
  a topic counts as reviewed only when none of its answers waits for a rating.
  Assisted and Not sure answers recorded before retries were removed never
  take a rating, so they do not hold a topic open.
- A resent last answer (same submission) also finishes the review, so a try
  that stopped before finishing heals itself.
- Opening the session page of a review whose topics are all reviewed, such
  as one answered before this change, finishes it and goes to its results.
- "Continue Review Session" then leads to the session page, which sends a
  finished review to its results.
- The session page's "All topics are answered. Finish the session…" message
  (from PR 175) is removed, since it can no longer be reached. Its render test
  in `tests/review-session-topics.test.ts` now checks the topic list a review
  still shows, and that the removed message is gone.

## Answers still being graded (two tabs)

Andrew asked for this fix too:

- A grammar review now writes the "graded, no verdict" marker when the AI
  grader gives no verdict or is not configured, as assessments already did.
  Practice sessions and assessments are unchanged.
- A review topic whose uncertain typed answer has neither an AI verdict nor
  that marker is still being graded, so it is not reviewed and the review
  stays open.
- The "every topic reviewed" check and the finish now run in one write
  transaction.
- Only a recent answer counts as being graded (the grader gives up after
  10 seconds; the window is 60 seconds). Answers from before this change have
  no marker, so older ones count as settled and do not hold a review open.
- Limit: if writing the marker itself fails within that minute, the review
  does not finish by itself until the window passes; Finish session still
  finishes it.
- Test: "waits for an answer still being graded in another tab" failed before
  the change (the review finished while the other answer was being graded)
  and passes now. Without the marker, four existing review cases fail, so
  they cover it. "does not wait for an older answer that never got a
  no-verdict marker" failed before the window and passes now.
  `tests/attempt-fallback.test.ts` checks the marker per session mode.

## Assisted retries removed

Andrew asked to remove assisted retries altogether, for practice sessions and
reviews alike:

- The lesson feedback no longer offers "Try this question again (assisted)",
  and the exercise form has no retry field.
- A retry form from an older page is refused as out of date and records
  nothing.
- Unchanged: past assisted answers and how they score, the
  `/app/api/attempts` endpoint, ratings and auto-finish. No migration.

Unchanged by auto-finish: Practice-page sessions, the Finish session button, the Review tab
lists, the five-topic limit. No migration.

## Checks run

- Red: on `origin/main` (c8d3523) source, the new journey cases "drops
  reviewed topics and finishes the review after the last one" and "finishes
  the review when the last topic is rated" failed (2 failed).
- Green: they pass, with `tests/learner-journeys.test.ts`,
  `tests/review-session-continue.test.ts`,
  `tests/grammar-retention.integration.test.ts`,
  `tests/grammar-retention.test.ts`, `tests/learner-routes.test.ts`,
  `tests/practice-render.test.ts`, `tests/review-render.test.ts`,
  `tests/lesson-load-round-trips.test.ts` (rating round-trip budget kept: the
  rating returns the session mode it already reads), `tests/assessment-routes.test.ts`,
  `tests/assessment.test.ts` and `tests/portuguese-tracks.test.ts`.
- The PR 175 journey case "drops a reviewed topic from the review session and
  the Review tab" was replaced by the first case above: with one topic, rating
  it now finishes the review, so the case uses two topics.
- `svelte-check`, ESLint and Prettier pass on changed files.
- Retry removal: red first on the old code, where the feedback still carried
  a retry and the browser check for no retry failed; green after.
  `tests/assessment-feedback.test.ts`, `tests/lesson-load-round-trips.test.ts`,
  `tests/review-session-continue.test.ts`, `tests/learner-journeys.test.ts`
  and the edited `tests/e2e/exercises.spec.ts` cases pass on desktop and
  mobile. "keeps refresh blocked until every mounted exercise is clear" is now
  "keeps refresh blocked while the next answer is being typed", since only
  one exercise is ever mounted.
- Not run here: the full suite and the other e2e specs, which CI runs.
