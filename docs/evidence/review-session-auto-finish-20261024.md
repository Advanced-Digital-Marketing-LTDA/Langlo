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
