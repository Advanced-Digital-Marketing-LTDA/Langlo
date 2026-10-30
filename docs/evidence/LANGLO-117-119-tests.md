# LANGLO-117 and LANGLO-119: remaining acceptance tests

Date: 2026-10-30. Test-only change; no application code changed.

## Added

- `tests/native-fsrs-golden.test.ts` (LANGLO-117): a fixed-clock golden schedule.
  Four new cards with fixed IDs are approved at 2026-03-02 08:00 UTC and each
  gets one rating at 09:00 UTC. Fuzz stays enabled, as the owner chose, and is
  seeded by card ID, so the schedule is deterministic. The test checks the empty
  starting state, that only the chosen rating is stored, the stored scheduler
  version and parameters, and that each button's preview matches the stored
  schedule: Again 1m, Hard 6m, Good 10m, Easy 10 days (due at the 04:00 UTC
  study-day start).
- `tests/native-review-grammar-separation.test.ts` (LANGLO-119): records a
  grammar answer, then rates one native card with all four ratings. Grammar
  mastery from `loadProgress` and the study session, attempt, evaluation,
  skill evidence and grammar retention rows stay identical.
- `tests/e2e/review-second-browser.spec.ts` (LANGLO-119): one learner signed in
  from two browsers. A Good rating in the first survives a reload. The second
  browser's stale page cannot add another rating and shows the stale-card
  message. After a reload, both browsers show nothing due. Exactly one event is
  stored and the card revision is 1.

## Observed

- The golden values were captured from the first run of the current scheduler
  (the placeholder expectation failed with the values above), then pinned. Two
  more runs passed with the same values.
- Local: Node 24.19.0, npm 11.9.0. `npm run check`, `npm run format:check`,
  ESLint on the new files and `npm test` (132 files, 2,196 tests) passed.
- The browser test was not run locally because this environment cannot
  download Playwright browsers. It runs in CI.

## Pending

These are characterization tests of existing behavior. They do not establish
production acceptance.
