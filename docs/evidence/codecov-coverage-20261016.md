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

## Pending acceptance

The shared workflow commit `57cd741cf0f04648e3c05e503cbd4839b6ce4abe` exists
locally in `/tmp/org-workflows-codecov` on branch `ci/codecov`. Langlo pins that
exact commit. Publish the shared commit before publishing the Langlo caller;
GitHub cannot resolve a workflow that exists only locally. This correction has
not been published. The earlier Langlo-only version remains on the remote
`ci/codecov-coverage` branch.

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
a matching Codecov repository, and access to the shared workflow. Secret presence,
Actions access settings, GitHub-hosted execution, and successful receipt by Codecov
were not checked. No upload, secret change, deployment, real provider call, or
paid review ran during local validation. Local coverage generation does not prove
hosted upload success. The Vite Codecov plugin was not installed or configured.
