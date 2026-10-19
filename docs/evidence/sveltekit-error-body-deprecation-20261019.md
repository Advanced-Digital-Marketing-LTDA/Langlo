# SvelteKit deprecated error body regression (PR #116 follow-up)

Observed locally on 2026-10-19 with Node 24.19.0 and npm 11.9.0. The two route
suites capture `console.warn` and fail if the SvelteKit
`error_body_deprecated` marker is emitted. Assertions cover status and
learner-safe message bodies for API, endpoint, lesson-page, and form paths,
including the 409 assessment-mode lesson-page response.

## Observed RED and GREEN

For RED, one call in `src/lib/server/learner-session.ts` was temporarily changed
from `error(401, 'Sign in required.')` to the deprecated object form
`error(401, { message: 'Sign in required.' })`. No temporary mutation was
committed.

Command, using npm 11.9.0:

```sh
npm test -- tests/mistake-card-routes.test.ts tests/learner-routes.test.ts
```

Observed RED: exit 1; 2 test files failed with 4 failed and 41 passed. Each
failure was the regression assertion seeing the deprecation warning (`warned`
was `true`). The mutation was then reverted.

With the string-form call restored, the same command produced **2 files passed,
45 tests passed**, and no `error_body_deprecated` warning.

## Required local checks

The commands below were run through npm 11.9.0 after `npm ci --ignore-scripts`.

- `npm run lint`: passed.
- `npm run test:property`: 5 files, 7 tests passed.
- `npm run build`: passed.
- `npm run test:e2e`: 90 tests passed across desktop and mobile.
- `npm run check`: failed with 2 type errors in the shared checkout's
  unstaged `tests/app-database.test.ts:69-70`; `environment: string` is not
  assignable to the `RuntimeConfig` environment union.
- `npm run format:check`: failed on
  `src/routes/app/learn/[language]/lesson/[skill]/+page.server.ts` and two
  unrelated files with unstaged changes:
  `tests/app-database-shared.test.ts` and `tests/mastery-updates.test.ts`.
- `npm test`: 80 files passed and 3 failed; 1307 tests passed and 14
  failed. `mastery.test.ts` and `mastery-updates.test.ts` include
  `computeMastery is not a function` failures (plus one unrelated ledger
  assertion); `tracing-spans.test.ts` has one missing-span assertion.
  Both changed route suites passed in this run.

`npm ci --ignore-scripts` installed 566 packages and reported 2 moderate audit
findings. No audit changes were made. Final inspection found unrelated unstaged edits in mastery, assessment,
database, progress, study, and related test files in the shared checkout. They
were left untouched and are not part of this follow-up commit. The full
repository check, format, and test results above describe that shared dirty
checkout, not a clean run of the PR commit. Hosted CI on the committed PR is
the clean-commit result.

## Review-gate follow-up (2026-10-19)

The first hosted Quality runs found the lesson-page route's existing `NOT_FOUND`
line was not formatted by Prettier. After formatting was corrected, Codecov
reported the other outcome of that conditional was not covered. The route tests
now exercise an assessment session opening a lesson page and assert the safe
409 response.

Re-verified in the shared checkout after that addition:

- `npm run check`: passed with 0 errors and 0 warnings.
- `npm test -- --coverage --coverage.reporter=lcov tests/mistake-card-routes.test.ts tests/learner-routes.test.ts`: 2 files, 46 tests passed.
- In `coverage/lcov.info`, both outcomes for `lessonFailure` line 26 ran: branch counts 2 and 1.
- Prettier and ESLint passed for both route suites and this evidence file.

The Codecov patch check for the commit containing this coverage follow-up has
not run yet.
