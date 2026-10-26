# PR 189: historical Jev pending-rating deadlock

Date: 2026-10-26. Local implementation; remote PR and CI acceptance pending.

## Behavior and scope

A resumed, retention-enabled practice session can show a matching historical
`jev-1` correct answer while the current `feedbackEvaluation()` is the prepared
uncertain result. Rating eligibility now accepts that historical correct
verdict when no matching current `jev-2` result supersedes it. A rating lets
the learner continue to the next exercise, but it does not make the historical
answer mastery evidence: mastery continues to use `feedbackEvaluation()`.

Current `jev-2` outcomes retain precedence, including uncertain and incorrect
outcomes. Incorrect historical answers and assisted answers remain unrated.
Assessment discard eligibility, confidence thresholds, retention rules,
schemas, migrations, and unrelated evaluation behavior are unchanged.

## Observed red and green

Tests use synthetic learners and disposable local fixture databases. No real
provider calls were made.

- Before the implementation, the resumed historical-correct integration test
  failed because the rating action returned HTTP 400 (`INVALID_GRAMMAR_RATING`);
  the other three targeted cases passed.
- After the implementation, five targeted cases passed: historical `jev-1`
  rating and continuation without mastery evidence, current `jev-2` rating,
  current uncertain precedence, historical incorrect rejection, and assisted
  answer rejection.
- Focused regression set: 7 files, 215 tests passed.

## Validation

Using Node 24.19.0 and npm 11.9.0:

- `npm ci --ignore-scripts`: passed with npm cache redirected to `/tmp` because
  the default cache directory was outside the workspace's writable paths.
- `npm run check`: passed, zero Svelte errors or warnings.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm test`: passed, 128 files and 2,176 tests.
- `npm run test:property`: passed, 6 files and 9 tests.
- `npm run build`: passed.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`:
  passed, 190 desktop and mobile tests, zero failures, flaky tests, or skips.
  The pinned Playwright download endpoint returned HTTP 403, so the installed
  system Chromium was used through the repository's supported executable-path
  setting.
- Internal adversarial review found no production correctness issues. Its
  copy-locking test concern was removed; tests assert behavior without fixing
  notice wording.

No schema changes or migrations were made. No production data, provider
credentials, external grader calls, deployment, or release were used.

## Pending acceptance

The initial scoped commit, push, draft PR creation, exact-commit CI inspection,
and comment triage remain pending. Local checks do not establish remote CI or
release acceptance.
