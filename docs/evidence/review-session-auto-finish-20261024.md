# Grammar review finishes once every topic is answered

Date: 2026-10-24. Requested and approved by Andrew in the project thread.

## Behavior

- A grammar review finishes by itself when its last topic is reviewed: when
  that topic's difficulty rating is saved, or when its answer is recorded if
  it takes no rating (incorrect, Not sure, uncertain). Finishing is the same
  as pressing "Finish session": the topics' schedules update.
- A correct answer still waiting for its rating does not finish the review.
- A resent last answer (same submission) also finishes the review, so a try
  that stopped before finishing heals itself.
- Opening the session page of a review whose topics are all reviewed, such
  as one answered before this change, finishes it and goes to its results.
- After a wrong answer on the last topic the review is finished, so the
  assisted retry ("Try this question again") is no longer offered for it.
- "Continue Review Session" then leads to the session page, which sends a
  finished review to its results.
- The session page's "All topics are answered. Finish the session…" message
  (from PR 175) is removed, since it can no longer be reached. Its render test
  in `tests/review-session-topics.test.ts` now checks the topic list a review
  still shows, and that the removed message is gone.

Unchanged: Practice-page sessions, the Finish session button, the Review tab
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
- Not run here: the full suite and the e2e specs, which CI runs.
