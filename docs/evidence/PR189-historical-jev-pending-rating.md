# PR 189: historical Jev pending-rating deadlock

Date: 2026-10-26. Draft PR #190 was opened from commit
`8fa0ce74d7e2568d04574dd2577ce7b50bf86925`. This evidence snapshot records
CI and review results for code commit
`29adc58f04c7cc12e63a3792f7b23486e68654ed`.

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
- `npm run check`: passed with zero Svelte errors or warnings.
- `npm run lint` and `npm run format:check`: passed.
- Initial local `npm test`: 128 files and 2,176 tests passed. The current-head
  CI report validated 2,176/2,176 tests across 129 suites.
- `npm run test:property`: 6 files and 9 tests passed.
- `npm run build` and `npm run build:e2e-coverage`: passed.
- `npm test -- tests/historical-jev-practice-rating.test.ts`: 5 tests passed
  after the test-only table-driven cleanup.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`:
  the local run passed 190 tests with zero failures, flaky tests, or skips
  before the unit-test-only cleanup. On current head `29adc58`, hosted E2E
  passed 190/190 tests in 5m 5s.
- The pinned Playwright download endpoint returned HTTP 403 in the local
  environment, so system Chromium was used locally through the supported
  executable-path setting. Hosted CI installed Chromium successfully.
- Internal adversarial review found no production correctness issues. Its
  copy-locking test concern was removed; tests assert behavior without fixing
  notice wording.

No schema changes or migrations were made. No production data, provider
credentials, external grader calls, deployment, or release were used.

## Remote CI and review snapshot

This is a fixed snapshot as of 2026-10-26 17:03 UTC for tested code commit
[`29adc58f04c7cc12e63a3792f7b23486e68654ed`](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/commit/29adc58f04c7cc12e63a3792f7b23486e68654ed).
These results apply to that commit; they do not claim validation of later
documentation-only commits.

- [Quality run 40362739329](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/actions/runs/40362739329)
  passed: 2,176/2,176 unit tests across 129 suites, property tests (6 files,
  9 tests), check, lint, format check, build, E2E coverage build, Chromium
  installation, and hosted E2E (190/190 tests, 5m 5s). Coverage and evidence
  validation passed. TestTrust reported one changed test file, zero findings,
  and 100/100. The APKG feasibility, merge-evidence, and Codecov upload jobs
  passed.
- [Dependency review 40362739061](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/actions/runs/40362739061),
  [Ratchets 40362739113](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/actions/runs/40362739113),
  [ESLint 40362739047](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/actions/runs/40362739047),
  [OSSAR 40362739365](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/actions/runs/40362739365),
  [rewardguard 40362739634](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/actions/runs/40362739634),
  and [adversarial review 40362739110](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/actions/runs/40362739110)
  passed.
- The [merge-evidence gate](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/190#issuecomment-6420958271)
  passed for `29adc58`. Its informational changed-files note used the PR-body
  snapshot captured when the push triggered CI, before the file list was added
  to the description. The description now lists all three changed files.
- [SonarCloud](https://sonarcloud.io/dashboard?id=Advanced-Digital-Marketing-LTDA_Langlo&pullRequest=190)
  passed with zero new issues and zero security hotspots. [CodeScene](https://codescene.io/projects/86244/delta/results/8137355)
  passed all six quality gates after the similar negative cases were
  consolidated with `it.each`. Codecov accepted the coverage upload for
  processing.
- The adversarial review refuted one preliminary finding and retained one
  below-gate documentation note that the earlier remote-review snapshot was
  stale. This snapshot is scoped to the tested commit and its linked results;
  no later CI result is implied.

The preceding Quality run on `0b6589b` was cancelled during Chromium setup at
the foundation job timeout, before browser tests. The successful hosted browser
run on `29adc58` supersedes that result.
