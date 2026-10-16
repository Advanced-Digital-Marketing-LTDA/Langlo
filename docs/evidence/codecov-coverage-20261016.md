# Vitest coverage and Codecov workflow

Owner approved installing Vitest and V8 coverage, then updating the existing
Quality workflow to generate and upload LCOV. The owner then corrected the scope
to use the organization workflows repository and approved the correction described
below. Application code, Vite configuration, repository secrets, and unrelated
working-tree edits were preserved.

## Changes

- Installed matching `vitest` and `@vitest/coverage-v8` versions `5.0.5`, saved as
  `^5.0.5`. The initial unversioned install failed with `ERESOLVE` because npm
  selected coverage 5.0.5 alongside installed Vitest 5.0.3. Installing the matching
  pair succeeded; subsequent `npm ci` and `npm ls` passed.
- The existing CI test command now generates `coverage/lcov.info` while retaining
  the JSON report consumed by the merge-evidence gate.
- Langlo uploads `coverage/lcov.info` as the `coverage` artifact, then calls the
  reusable workflow in `Advanced-Digital-Marketing-LTDA/workflows` in a separate
  job that depends on `foundation`. The previous direct Codecov action and fixed
  Langlo slug were removed. Only `CODECOV_TOKEN` is forwarded; fork PR uploads
  remain skipped.
- Preserved all-branch push/PR triggers, pinned toolchain, `--ignore-scripts`
  CI installations, read-only workflow permissions, and existing quality checks.

## Observed validation

Node `24.19.0`; npm `11.9.0` selected through `npm exec`.

- Red: `npm test -- tests/codecov-workflow.test.ts` exited 1: 2 tests failed
  because coverage generation and the upload step were absent.
- Green: the exact CI coverage command exited 0: 470 tests passed across 40 files.
  `node scripts/validate-vitest-evidence.mjs .ci-reports/vitest.json` confirmed
  470/470 passed, with no failed or skipped/disabled tests.
- Generated LCOV contained 47 source records and completed record markers.
- `npm ci` passed and reported zero vulnerabilities.
- `npm run check`, `npm run lint`, `npm run format:check`, `npm test`,
  `npm run test:property`, `npm run build`, and `npm run test:e2e` passed after
  dependency installation. Ordinary tests passed 468 tests before the two workflow
  tests were added; properties passed 5 tests; browser tests passed 72 tests.
- Check and lint passed again after adding the workflow and regression tests.
- `git diff --check` passed.

## Publication preparation

The owner subsequently authorized pushing and explicitly removed the mandatory
PR Review Toolkit, external adversarial review, and gstack review requirements
from `AGENTS.md`. Those reviews were not run. The spec-validation rule and other
repository guidance remain in place.

Before publication, the Codecov commit was rebased onto remote main
`0cfaa1c41cd2b8530aa431bfdffc1d8f1fe601b3`, preserving incoming curriculum and
import changes. Clean installation, check, lint, formatting, coverage tests,
property tests, and build passed again on the combined tree. Coverage tests
passed 813 tests across 41 files; the existing evidence validator confirmed
zero failed or skipped/disabled tests. All 72 browser tests also passed again.

## Shared workflow integration

The shared workflow commit `57cd741cf0f04648e3c05e503cbd4839b6ce4abe` was
published and merged into `Advanced-Digital-Marketing-LTDA/workflows` main via
PR #1. Langlo pins that exact commit. The Langlo caller was published as
`6d50191a3a7b072443b73bc5d5aeb2b0f0ac7f8b` on `ci/codecov-coverage`, used by
PR #83. The branch was restored at that same SHA after accidental deletion.

The shared workflow downloads an artifact from the caller's current run and
passes the selected report to Codecov with `slug: ${{ github.repository }}`.
Artifact name and downloaded report path are inputs. It does not install
dependencies or run tests, so callers retain their own language and test setup.
Its README documents adoption, report layout, secrets, and publication order.
Other organization repositories must opt in individually; none were modified.
The existing shared Coveralls workflow was preserved.

The correction's observed red/green checks:

- Shared repo: `node --test tests/codecov.test.mjs` exited 1 with 3 failed tests
  before the reusable workflow existed; after implementation all 3 passed.
- Langlo: the updated workflow test exited 1 with 1 failed and 1 passed test
  against the old direct upload; after the artifact/caller change both passed.
- Actionlint `1.7.12` passed for both the shared workflow and Langlo's caller.
  Shellcheck was disabled; the new workflow has no shell steps.
- In `/tmp/langlo-shared-codecov-validation`, a clean checkout of Langlo plus
  only the three correction files passed `npm ci`, `npm run check`, `npm run lint`,
  `npm run format:check`, the full coverage-enabled test command,
  `npm run test:property`, `npm run build`, and `npm run test:e2e`. Coverage tests
  passed 813 tests across 41 files; the evidence validator confirmed no failed or
  skipped/disabled tests. LCOV contained 48 source records. All 72 browser tests
  passed. This isolated validation excluded concurrent Stryker package/config
  changes in the main working tree; those unrelated changes were left intact.

Each caller needs a suitable `CODECOV_TOKEN` repository or organization secret,
a matching Codecov repository, and access to the shared workflow. Initial hosted
uploads received an empty token and failed with "Token required because branch
is protected". After the owner added the organization secret and updated access,
the Codecov-only rerun succeeded: job `117184463491` in run `38962945517` received
a nonempty token, found `coverage/lcov.info`, and queued the upload for processing.
This verifies the hosted artifact handoff and upload acceptance for caller
`6d50191`; Codecov's final report processing was not checked. The agent did not
read or change the secret value.

## Merge-conflict resolution for PR #83

The owner approved merging main `7f8e117b2ea79b624b6f17a272f135658fdaa6a0`
into caller branch head `6d50191a3a7b072443b73bc5d5aeb2b0f0ac7f8b` in an
isolated checkout at `/tmp/langlo-codecov-conflict-resolution`.

Only `.github/workflows/ci.yml` and `tests/codecov-workflow.test.ts` conflicted.
Main pinned the older direct Codecov action; the PR instead delegates uploading
to the shared workflow. Both conflicts retain the PR's artifact upload, pinned
shared workflow call, explicit secret forwarding, fork guard, and matching tests.
All nonconflicting changes from main were retained, including question holdouts
and their migration. No migrations were applied outside disposable local fixtures.
Concurrent Stryker working-tree files in the original checkout were left intact.

Observed focused validation:

- Red: with the shared-workflow test restored and the workflow still conflicted,
  `npm test -- tests/codecov-workflow.test.ts` exited 1 with 1 failed and 1 passed
  test. The artifact step did not contain `name: coverage` because the conflicting
  direct-upload step interrupted it.
- Green: after resolving the workflow, the same command passed both tests.
- Actionlint `1.7.12` passed for the resolved workflow with shellcheck disabled.
- Full merged-tree validation passed with Node `24.19.0` and npm `11.9.0`:
  `npm ci --ignore-scripts`, `npm run check`, `npm run lint`,
  `npm run format:check`, the coverage-enabled `npm test` command,
  `npm run test:property`, `npm run build`, and `npm run test:e2e`.
  Tests passed 827/827 across 41 files; the evidence validator confirmed no failed
  or skipped/disabled tests. The property run passed 5 tests and browser tests
  passed 72 tests. `git ls-files -u` returned no unresolved entries, and
  `git diff --cached --check` passed.

## Pending acceptance

The merge resolution has not been published. Hosted checks must run on its exact
new commit after publication; success on `6d50191` does not validate the merged
tree. PR #83's earlier TestTrust failure remains a separate hosted finding and
has not been changed as part of this conflict resolution. No PR merge, deployment,
secret change, or paid review was performed. The shared workflow repository was
not modified. The Vite Codecov plugin was not installed or configured.
