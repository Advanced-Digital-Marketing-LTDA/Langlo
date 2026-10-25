# A finished grammar review goes to the Review tab

Date: 2026-10-25. Requested and approved by Andrew in the project thread.

## Behavior

- When an answer or a difficulty rating reviews the last topic of a grammar
  review, the lesson's `answer` and `rate` actions save the review (as before)
  and redirect to `/app/review?language=<language>` instead of showing the
  lesson page. It applies to every question type: multiple choice, typed
  (including answers the AI grader settles), incorrect, Not sure and rated
  answers, and to a resent last answer.
- Opening a lesson of a review that is already finished redirects to the same
  Review tab, so "Continue Review Session" no longer shows when no topic is
  left. It still shows while topics remain.
- The Review tab's Grammar section shows "N topics already reviewed today":
  the distinct topics with a saved review within the 4am study day. Topics
  that come due again the same day stay listed as due today, as set on
  2026-10-24; only the count is new.
- `finishReviewedGrammarReview` now reports whether the review finished.

Unchanged: scheduling and FSRS, due and overdue rules, flashcards, the session
page, assessments, practice sessions. No migration.

## Checks run

- Red: with the source change in place and the tests not yet updated, seven
  existing cases in "grammar practice rating and review actions" failed, since
  the last-topic `answer`/`rate` calls now redirect; the `toEqual` on the
  rating result failed on the new `reviewFinished` field. Those assertions were
  updated to expect the redirect (approved by Andrew).
- Green: `tests/learner-journeys.test.ts` (67 tests),
  `tests/home-analytics-round-trips.test.ts`, `tests/learner-routes.test.ts`,
  `tests/review-render.test.ts`, `tests/lesson-update-notice.test.ts`,
  `tests/assessment-feedback.test.ts`, `tests/review-session-continue.test.ts`,
  `tests/lesson-load-round-trips.test.ts` and
  `tests/grammar-retention.integration.test.ts` pass.
- New case "shows on the Review tab how many topics were already reviewed
  today": the count is 1 before the review finishes and 2 after its last answer.
  The existing AI-grader case also asserts `reviewFinished: true` once the
  grader settles. The last-answer redirect is asserted by the updated cases for
  a rated answer, an incorrect answer and a resent answer, and the lesson of a
  finished review by the updated lesson-load assertion.
- `svelte-check`, ESLint and Prettier pass on changed files.

## Pending

- Not run here: the full suite and the e2e specs, which CI runs.
- A "Not sure" last answer has no case of its own; it takes the same finish
  path as the incorrect-answer case.
- Not confirmed on a real deploy: the redirect after the last topic and the
  reviewed-today count are pending Andrew's acceptance in the running app.
