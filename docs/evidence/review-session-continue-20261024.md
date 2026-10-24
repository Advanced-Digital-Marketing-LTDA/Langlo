# Review tab: continue the unfinished grammar review

Date: 2026-10-24. Reported and approved by Andrew in the project thread.

## Problem

After answering grammar review questions, the practice session screen said
"0 answers so far". Answers were saved, but every Review tab grammar button
started a new review session, and a lesson had no way back to its review. So
returning to the Review tab and clicking again opened a new, empty session.

## Behavior

- A Review tab grammar button continues the learner's unfinished grammar
  review in that language, if there is one. A new review starts only when none
  is unfinished.
- A lesson opened from a grammar review shows a "Continue Review Session" link
  at the bottom of the page once the answer needs nothing more: after the
  difficulty rating, or at once when the answer takes no rating (incorrect,
  Not sure, assisted retry). It links to that review's session page.

- A reviewed topic leaves both lists: the review session page and the Review
  tab's overdue and due-today lists for that language (Andrew chose "Both
  lists"). A topic counts as reviewed once its answer needs nothing more, so
  a correct answer still waiting for its difficulty rating stays listed. When
  every topic is reviewed, the session page says "All topics are answered.
  Finish the session to update their schedules." instead of "No lessons are
  published in this track yet."

- An unfinished review with a retired or missing topic cannot load, so the
  Review tab does not continue it (or read its topics); it starts a new review
  as before this change.

Unchanged: Practice-page reviews, the five-topic limit, and how a review is
finished and rated. No migration.

## Checks run

- Red: on `origin/main` (adc0b8d) source, the new cases in
  `tests/review-session-continue.test.ts` and the extended Review tab case in
  `tests/learner-journeys.test.ts` failed (3 failed): a second click opened a
  new review, and no "Continue Review Session" link existed.
- Green (this branch): those files plus `tests/lesson-update-notice.test.ts`,
  `tests/lesson-load-round-trips.test.ts`, `tests/learner-routes.test.ts` and
  `tests/review-render.test.ts`: 122 passed.
- Reviewed topics, red: on the previous branch head (53ee4e0) source, the new
  journey case "drops a reviewed topic from the review session and the Review
  tab" and `tests/review-session-topics.test.ts` failed. Green: they pass, with
  `tests/grammar-retention.integration.test.ts` (its review plan now also
  reports `reviewed`), `tests/grammar-retention.test.ts`,
  `tests/practice-render.test.ts`, `tests/review-render.test.ts`,
  `tests/review-session-continue.test.ts` and `tests/learner-routes.test.ts`.
- Review follow-up: the new journey case "continues only the learner's own
  live unfinished review" failed before the retired-topic check (a review
  with a retired topic was still continued) and passes after it. It also
  covers another learner and a finished review.
- `svelte-check`, ESLint and Prettier pass on changed files.
- Not run here: the full suite and the e2e specs, which CI runs.
