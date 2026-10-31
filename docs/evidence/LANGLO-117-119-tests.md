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
  mastery from `loadProgress` and every owner's study session, attempt,
  evaluation, skill evidence and grammar retention rows stay identical.
- `tests/e2e/review-second-browser.spec.ts` (LANGLO-119): one learner signed in
  from two browsers. A Good rating in the first survives a reload. The second
  browser's stale page cannot add another rating and shows the stale-card
  message. After a reload, both browsers show nothing due. Exactly one event is
  stored and the card revision is 1.

## Observed

- These are characterization tests, not test-first tests. The golden values
  were copied from the current implementation: a placeholder expectation failed
  and printed the values above, which were then pinned. Two more runs passed
  with the same values.
- Red, golden schedule: with Again's expected preview changed locally to `2m`,
  the test failed with an `AssertionError` on the outcomes object (`1m`
  received). Restored, it passed.
- Red, grammar separation: with a local
  `UPDATE study_sessions SET created_at = created_at + 1 WHERE owner_id = 'learner-b'`
  added after the reviews, the test failed on `created_at` (`1793400317000`
  expected, `1793400317001` received). The earlier version, which only read
  `learner-a`'s rows, passed with the same change. Restored, it passed.
- No red run was recorded for the browser test, because it cannot run here.
- Local: Node 24.19.0, npm 11.9.0. `npm run check`, `npm run lint`,
  `npm run format:check`, `npm test` (132 files, 2,196 tests),
  `npm run test:property` (7 files, 10 tests) and `npm run build` passed.
- `npm run test:e2e` was not run locally because this environment cannot
  download Playwright browsers. It runs in CI in the foundation job.

## Pending

These are characterization tests of existing behavior. They do not establish
production acceptance.
